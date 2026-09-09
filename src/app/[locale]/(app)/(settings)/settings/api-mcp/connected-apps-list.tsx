"use client";

import { BadgeCheck, Plug, ShieldQuestion } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ApiScopeDisclosure } from "@/components/api-scope-disclosure";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { EmptyStateCard } from "@/components/empty-state-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
        <p className="max-w-prose text-sm text-muted-foreground">{t("description")}</p>
      </div>

      {apps.length === 0 ? (
        <EmptyStateCard
          icon={Plug}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        // Same ledger as the API key list: a grant is a row, and its scopes fold away by default.
        <ul className="divide-y rounded-lg border bg-card text-card-foreground">
          {apps.map((app) => (
            <li key={app.grantId} className="space-y-3 p-5 sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="truncate font-semibold leading-tight">
                      {app.name ?? t("unknownApp")}
                    </h3>
                    <Badge variant={app.isVerified ? "default" : "secondary"} className="gap-1">
                      {app.isVerified
                        ? <BadgeCheck className="size-3.5" />
                        : <ShieldQuestion className="size-3.5" />}
                      {app.isVerified ? t("verifiedBadge") : t("unverifiedBadge")}
                    </Badge>
                  </div>
                  <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {app.grantedAt ? (
                      <span>{t("grantedLabel", { date: formatDate(new Date(app.grantedAt), locale) })}</span>
                    ) : null}
                    <span className="font-mono">{app.clientId}</span>
                  </p>
                </div>

                <ConfirmDestructiveDialog
                  trigger={
                    <Button
                      size="sm"
                      variant="ghost"
                      className="-ml-3 shrink-0 self-start text-destructive hover:bg-destructive/10 hover:text-destructive sm:-mr-2 sm:-mt-1 sm:ml-0"
                    />
                  }
                  triggerLabel={t("revoke")}
                  title={t("revokeConfirmTitle")}
                  description={t("revokeConfirmDescription")}
                  confirmLabel={t("revoke")}
                  pendingLabel={t("revoking")}
                  onConfirm={() => revoke({ grantId: app.grantId })}
                />
              </div>

              <ApiScopeDisclosure scopes={app.scopes} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
