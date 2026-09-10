"use client";

import { Plug } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { ClientVerificationBadge } from "@/components/credentials/client-verification-badge";
import { CredentialLedger, CredentialRow } from "@/components/credentials/credential-ledger";
import { Button } from "@/components/ui/button";
import type { ConnectedApp } from "@/lib/oauth/connected-apps";
import { revokeUserConnectedAppAction } from "../../_actions/user-credentials-actions";
import { RelativeDateCell } from "../relative-date-cell";
import { AdminDetailSection } from "../admin-detail-section";

export function UserConnectedApps({ userId, apps }: { userId: string; apps: ConnectedApp[] }) {
  const t = useTranslations("Client.Admin.UserDetail");
  const router = useRouter();

  const { executeAsync: revokeApp } = useAction(revokeUserConnectedAppAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || t("toastRevokeAppError"));
    },
    onSuccess: () => {
      toast.success(t("toastRevokeAppSuccess"));
      router.refresh();
    },
  });

  return (
    <AdminDetailSection
      icon={Plug}
      title={t("connectedAppsTitle", { count: apps.length })}
      description={t("connectedAppsDescription")}
      emptyMessage={t("connectedAppsEmpty")}
      isEmpty={apps.length === 0}
    >
      <CredentialLedger>
        {apps.map((app) => (
          <CredentialRow
            key={app.grantId}
            title={app.name ?? t("unknownApp")}
            titleBadge={
              <ClientVerificationBadge
                isVerified={app.isVerified}
                label={app.isVerified ? t("verified") : t("unverified")}
              />
            }
            facts={[
              <span key="client" className="font-mono break-all">{app.clientId}</span>,
              <RelativeDateCell
                key="granted"
                value={app.grantedAt ? new Date(app.grantedAt) : null}
                emptyLabel={t("unknownDate")}
              />,
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
                title={t("revokeAppTitle")}
                description={t("revokeAppDescription", { name: app.name ?? t("unknownApp") })}
                confirmLabel={t("revoke")}
                pendingLabel={t("revoking")}
                onConfirm={() => revokeApp({ userId, grantId: app.grantId })}
              />
            }
            scopes={app.scopes}
          />
        ))}
      </CredentialLedger>
    </AdminDetailSection>
  );
}
