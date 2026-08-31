"use client";

import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { API_KEY_CACHE_TTL_SECONDS } from "@/constants";
import type { AdminApiKeySummary } from "@/lib/admin/user-credentials";
import { revokeUserApiKeyAction } from "../../_actions/user-credentials-actions";
import { AdminApiKeysTable } from "../admin-api-keys-table";
import { AdminDetailSection } from "../admin-detail-section";

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
    <AdminDetailSection
      icon={KeyRound}
      title={t("apiKeysTitle", { count: apiKeys.length })}
      description={t("apiKeysDescription", {
        minutes: Math.ceil(API_KEY_CACHE_TTL_SECONDS / 60),
      })}
      emptyMessage={t("apiKeysEmpty")}
      isEmpty={apiKeys.length === 0}
    >
      <AdminApiKeysTable
        apiKeys={apiKeys}
        subjectHeader={t("columnTeam")}
        renderSubject={(apiKey) => (
          apiKey.teamId
            ? <Badge variant="secondary">{apiKey.teamName ?? apiKey.teamId}</Badge>
            : <span className="text-muted-foreground">{t("personalKey")}</span>
        )}
        onRevoke={(apiKey) => revokeKey({ userId, keyId: apiKey.id })}
      />
    </AdminDetailSection>
  );
}
