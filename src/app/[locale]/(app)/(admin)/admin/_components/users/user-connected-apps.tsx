"use client";

import { BadgeCheck, Plug, ShieldQuestion } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columnApp")}</TableHead>
            <TableHead>{t("columnClientId")}</TableHead>
            <TableHead>{t("columnScopes")}</TableHead>
            <TableHead>{t("columnGranted")}</TableHead>
            <TableHead className="text-right">{t("columnAction")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {apps.map((app) => (
            <TableRow key={app.grantId}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{app.name ?? t("unknownApp")}</span>
                  <Badge variant={app.isVerified ? "default" : "secondary"} className="gap-1">
                    {app.isVerified
                      ? <BadgeCheck className="size-3.5" />
                      : <ShieldQuestion className="size-3.5" />}
                    {app.isVerified ? t("verified") : t("unverified")}
                  </Badge>
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs break-all">{app.clientId}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {app.scopes.map((scope) => (
                    <Badge key={scope} variant="outline" className="font-mono text-xs">
                      {scope}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <RelativeDateCell
                  value={app.grantedAt ? new Date(app.grantedAt) : null}
                  emptyLabel={t("unknownDate")}
                />
              </TableCell>
              <TableCell className="text-right">
                <ConfirmDestructiveDialog
                  trigger={<Button size="sm" variant="destructive" />}
                  triggerLabel={t("revoke")}
                  title={t("revokeAppTitle")}
                  description={t("revokeAppDescription", { name: app.name ?? t("unknownApp") })}
                  confirmLabel={t("revoke")}
                  pendingLabel={t("revoking")}
                  onConfirm={() => revokeApp({ userId, grantId: app.grantId })}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AdminDetailSection>
  );
}
