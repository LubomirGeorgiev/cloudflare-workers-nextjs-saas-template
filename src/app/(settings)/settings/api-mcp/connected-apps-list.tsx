"use client";

import { BadgeCheck, Plug, ShieldQuestion } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ApiScopeGrid } from "@/components/api-scope-grid";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { EmptyStateCard } from "@/components/empty-state-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConnectedApp } from "@/lib/oauth/connected-apps";
import { formatDate } from "@/utils/format-date";
import { revokeConnectedAppAction } from "./api-mcp.actions";

export function ConnectedAppsList({ apps }: { apps: ConnectedApp[] }) {
  const t = useTranslations("Client.Settings.ConnectedApps");
  const locale = useLocale();
  const router = useRouter();

  const { executeAsync: revoke } = useAction(revokeConnectedAppAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || t("toastRevokeError"));
    },
    onSuccess: () => {
      toast.success(t("toastRevokeSuccess"));
      router.refresh();
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      {apps.length === 0 ? (
        <EmptyStateCard
          icon={Plug}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="space-y-4">
          {apps.map((app) => (
            <Card key={app.grantId}>
              <CardHeader className="pb-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {app.name ?? t("unknownApp")}
                      <Badge variant={app.isVerified ? "default" : "secondary"} className="gap-1">
                        {app.isVerified
                          ? <BadgeCheck className="size-3.5" />
                          : <ShieldQuestion className="size-3.5" />}
                        {app.isVerified ? t("verifiedBadge") : t("unverifiedBadge")}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      {app.grantedAt ? (
                        <span>{t("grantedLabel", { date: formatDate(new Date(app.grantedAt), locale) })}</span>
                      ) : null}
                      <span className="font-mono">{app.clientId}</span>
                    </CardDescription>
                  </div>

                  <ConfirmDestructiveDialog
                    trigger={
                      <Button size="sm" variant="destructive" className="w-full sm:w-auto" />
                    }
                    triggerLabel={t("revoke")}
                    title={t("revokeConfirmTitle")}
                    description={t("revokeConfirmDescription")}
                    confirmLabel={t("revoke")}
                    pendingLabel={t("revoking")}
                    onConfirm={() => revoke({ grantId: app.grantId })}
                  />
                </div>
              </CardHeader>
              <CardContent className="border-t pt-4">
                <p className="text-xs font-medium text-muted-foreground">{t("scopesLabel")}</p>
                <ApiScopeGrid scopes={app.scopes} className="mt-3" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
