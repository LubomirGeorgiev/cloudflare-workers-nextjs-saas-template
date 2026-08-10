"use client";

import { KeyRound } from "lucide-react";
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
import { API_KEY_CACHE_TTL_SECONDS } from "@/constants";
import type { AdminApiKeySummary } from "@/lib/admin/user-credentials";
import { formatApiKeyHint } from "@/utils/api-key-format";
import { revokeUserApiKeyAction } from "../../_actions/user-credentials-actions";
import { RelativeDateCell } from "../relative-date-cell";
import { AdminUserSection } from "./admin-user-section";

export function UserApiKeys({ userId, apiKeys }: { userId: string; apiKeys: AdminApiKeySummary[] }) {
  const t = useTranslations("Client.Admin.UserDetail");
  const router = useRouter();

  const { executeAsync: revokeKey } = useAction(revokeUserApiKeyAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || t("toastRevokeKeyError"));
    },
    onSuccess: () => {
      toast.success(t("toastRevokeKeySuccess"));
      router.refresh();
    },
  });

  return (
    <AdminUserSection
      icon={KeyRound}
      title={t("apiKeysTitle", { count: apiKeys.length })}
      description={t("apiKeysDescription", {
        minutes: Math.ceil(API_KEY_CACHE_TTL_SECONDS / 60),
      })}
      emptyMessage={t("apiKeysEmpty")}
      isEmpty={apiKeys.length === 0}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columnName")}</TableHead>
            <TableHead>{t("columnKey")}</TableHead>
            <TableHead>{t("columnTeam")}</TableHead>
            <TableHead>{t("columnScopes")}</TableHead>
            <TableHead>{t("columnCreated")}</TableHead>
            <TableHead>{t("columnLastUsed")}</TableHead>
            <TableHead>{t("columnExpires")}</TableHead>
            <TableHead className="text-right">{t("columnAction")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {apiKeys.map((apiKey) => (
            <TableRow key={apiKey.id}>
              <TableCell className="font-medium">{apiKey.name}</TableCell>
              <TableCell>
                <Badge variant="outline" className="font-mono text-xs">
                  {formatApiKeyHint({ keyPrefix: apiKey.keyPrefix, last4: apiKey.last4 })}
                </Badge>
              </TableCell>
              <TableCell>
                {apiKey.teamId
                  ? <Badge variant="secondary">{apiKey.teamName ?? apiKey.teamId}</Badge>
                  : <span className="text-muted-foreground">{t("personalKey")}</span>}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {apiKey.scopes.map((scope) => (
                    <Badge key={scope} variant="outline" className="font-mono text-xs">
                      {scope}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell><RelativeDateCell value={apiKey.createdAt} /></TableCell>
              <TableCell>
                <RelativeDateCell value={apiKey.lastUsedAt} emptyLabel={t("never")} />
              </TableCell>
              <TableCell>
                <RelativeDateCell value={apiKey.expiresAt} emptyLabel={t("never")} />
              </TableCell>
              <TableCell className="text-right">
                <ConfirmDestructiveDialog
                  trigger={<Button size="sm" variant="destructive" />}
                  triggerLabel={t("revoke")}
                  title={t("revokeKeyTitle")}
                  description={t("revokeKeyDescription", { name: apiKey.name })}
                  confirmLabel={t("revoke")}
                  pendingLabel={t("revoking")}
                  onConfirm={() => revokeKey({ userId, keyId: apiKey.id })}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AdminUserSection>
  );
}
