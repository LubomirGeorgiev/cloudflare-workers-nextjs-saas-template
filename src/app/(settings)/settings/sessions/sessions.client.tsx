"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAction } from "next-safe-action/hooks";
import { deleteSessionAction } from "./sessions.actions";
import { Badge } from "@/components/ui/badge";
import { formatRelativeDateTime } from "@/utils/format-date";
import { formatDeviceDescription } from "@/utils/format-device-description";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { toast } from "sonner";
import React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { SessionWithMeta } from "@/types";
import { useLocale, useTranslations } from "next-intl";

function getAuthMethodLabel({
  authenticationType,
  t,
}: {
  authenticationType: NonNullable<SessionWithMeta["authenticationType"]>;
  t: ReturnType<typeof useTranslations<"Client.Settings.Sessions">>;
}): string {
  switch (authenticationType) {
    case "password":
      return t("authMethodPassword");
    case "passkey":
      return t("authMethodPasskey");
    case "google-oauth":
      return t("authMethodGoogleOauth");
  }
}


export function SessionsClient({ sessions }: { sessions: SessionWithMeta[] }) {
  const router = useRouter();
  const locale = useLocale();
  const regionNames = React.useMemo(
    () => new Intl.DisplayNames([locale], { type: "region" }),
    [locale],
  );
  const t = useTranslations("Client.Settings.Sessions");
  const tDevice = useTranslations("Client.Settings.Device");
  const { executeAsync: deleteSession } = useAction(deleteSessionAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || t("toastDeleteError"));
    },
    onSuccess: () => {
      toast.success(t("toastDeleteSuccess"));
      router.refresh();
    }
  });

  return (
    <div className="space-y-4">
      {sessions.map((session) => (
        <Card key={session.id} className={cn(!session.isCurrentSession ? "bg-card/40" : "border-3 border-primary/20 shadow-lg bg-secondary/30")}>
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {session.city && session.country
                      ? `${session.city}, ${regionNames.of(session.country)}`
                      : session.country || t("unknownLocation")}
                    {session.isCurrentSession && <Badge>{t("currentSessionBadge")}</Badge>}
                  </CardTitle>
                  {session?.authenticationType && (
                    <Badge variant='outline'>
                      {t("authenticatedWith", {
                        method: getAuthMethodLabel({
                          authenticationType: session.authenticationType,
                          t,
                        }),
                      })}
                    </Badge>
                  )}
                  <div className="text-sm text-muted-foreground whitespace-nowrap">
                    &nbsp;· &nbsp;{formatRelativeDateTime(session.createdAt, locale)}
                  </div>
                </div>
                <CardDescription className="text-sm">
                  {formatDeviceDescription({ t: tDevice, parsedUserAgent: session.parsedUserAgent })}
                </CardDescription>
              </div>
              <div>
                {!session?.isCurrentSession && (
                  <ConfirmDestructiveDialog
                    trigger={
                      <Button size="sm" variant="destructive" className="w-full sm:w-auto" />
                    }
                    triggerLabel={t("deleteSession")}
                    title={t("deleteSessionConfirmTitle")}
                    description={t("deleteSessionConfirmDescription")}
                    confirmLabel={t("deleteSession")}
                    pendingLabel={t("deletingSession")}
                    onConfirm={() => deleteSession({ sessionId: session.id })}
                  />
                )}
              </div>
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
