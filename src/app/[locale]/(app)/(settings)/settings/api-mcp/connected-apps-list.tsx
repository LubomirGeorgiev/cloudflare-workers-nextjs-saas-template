"use client";

import { Plug } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { ClientVerificationBadge } from "@/components/credentials/client-verification-badge";
import { CredentialLedger, CredentialRow } from "@/components/credentials/credential-ledger";
import { EmptyStateCard } from "@/components/empty-state-card";
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
        <CredentialLedger>
          {apps.map((app) => (
            <CredentialRow
              key={app.grantId}
              title={app.name ?? t("unknownApp")}
              titleBadge={
                <ClientVerificationBadge
                  isVerified={app.isVerified}
                  label={app.isVerified ? t("verifiedBadge") : t("unverifiedBadge")}
                />
              }
              facts={[
                app.grantedAt
                  ? t("grantedLabel", { date: formatDate(new Date(app.grantedAt), locale) })
                  : null,
                <span key="client" className="font-mono">{app.clientId}</span>,
              ]}
              actions={
                <ConfirmDestructiveDialog
                  trigger={
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    />
                  }
                  triggerLabel={t("revoke")}
                  title={t("revokeConfirmTitle")}
                  description={t("revokeConfirmDescription")}
                  confirmLabel={t("revoke")}
                  pendingLabel={t("revoking")}
                  onConfirm={() => revoke({ grantId: app.grantId })}
                />
              }
              scopes={app.scopes}
            />
          ))}
        </CredentialLedger>
      )}
    </div>
  );
}
