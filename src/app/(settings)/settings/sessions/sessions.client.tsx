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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
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
  const dialogCloseRef = React.useRef<HTMLButtonElement>(null);
  const t = useTranslations("Client.Settings.Sessions");
  const tCommon = useTranslations("Client.Common");
  const tDevice = useTranslations("Client.Settings.Device");
  const { execute: deleteSession } = useAction(deleteSessionAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || t("toastDeleteError"));
    },
    onSuccess: () => {
      toast.success(t("toastDeleteSuccess"));
      dialogCloseRef.current?.click();
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
                  <Dialog>
                    <DialogTrigger
                      render={<Button size="sm" variant="destructive" className="w-full sm:w-auto" />}
                    >
                      {t("deleteSession")}
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("deleteSessionConfirmTitle")}</DialogTitle>
                        <DialogDescription>
                          {t("deleteSessionConfirmDescription")}
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter className="mt-6 sm:mt-0">
                        <DialogClose
                          ref={dialogCloseRef}
                          render={<Button variant="outline" />}
                        >
                          {tCommon("cancel")}
                        </DialogClose>
                        <Button
                          variant="destructive"
                          className="mb-4 sm:mb-0"
                          onClick={() => deleteSession({ sessionId: session.id })}
                        >
                          {t("deleteSession")}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
