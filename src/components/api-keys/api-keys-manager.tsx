"use client";

import { KeyRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { revokeApiKeyAction } from "@/actions/api-key-actions";
import { CreateApiKeyDialog } from "@/components/api-keys/create-api-key-dialog";
import { EditApiKeyScopesDialog } from "@/components/api-keys/edit-api-key-scopes-dialog";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { EmptyStateCard } from "@/components/empty-state-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { API_KEY_CACHE_TTL_SECONDS } from "@/constants";
import type { ApiKeySummary } from "@/lib/api-keys/api-keys";
import { formatApiKeyHint } from "@/utils/api-key-format";
import { formatDate } from "@/utils/format-date";

interface ApiKeysManagerProps {
  apiKeys: ApiKeySummary[];
  /** Set for a team-scoped key list; the permission check happens server-side. */
  teamId?: string;
}

export function ApiKeysManager({ apiKeys, teamId }: ApiKeysManagerProps) {
  const t = useTranslations("Client.Settings.ApiKeys");
  const locale = useLocale();
  const router = useRouter();

  const { executeAsync: revokeKey } = useAction(revokeApiKeyAction, {
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          {/* A team key is confined to its team, so the personal copy would over-promise here. */}
          <p className="text-sm text-muted-foreground">
            {t(teamId ? "teamDescription" : "description")}
          </p>
        </div>

        <CreateApiKeyDialog teamId={teamId} />
      </div>

      {apiKeys.length === 0 ? (
        <EmptyStateCard
          icon={KeyRound}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="space-y-4">
          {apiKeys.map((apiKey) => (
            <Card key={apiKey.id}>
              <CardHeader>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {apiKey.name}
                      <Badge variant="outline" className="font-mono text-xs">
                        {formatApiKeyHint({ keyPrefix: apiKey.keyPrefix, last4: apiKey.last4 })}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span>{t("createdLabel", { date: formatDate(apiKey.createdAt, locale) })}</span>
                      <span>
                        {apiKey.lastUsedAt
                          ? t("lastUsedLabel", { date: formatDate(apiKey.lastUsedAt, locale) })
                          : t("lastUsedNever")}
                      </span>
                      <span>
                        {apiKey.expiresAt
                          ? t("expiresLabel", { date: formatDate(apiKey.expiresAt, locale) })
                          : t("expiresNever")}
                      </span>
                    </CardDescription>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <EditApiKeyScopesDialog apiKey={apiKey} />

                    <ConfirmDestructiveDialog
                      trigger={
                        <Button size="sm" variant="destructive" className="w-full sm:w-auto" />
                      }
                      triggerLabel={t("revoke")}
                      title={t("revokeConfirmTitle")}
                      description={t("revokeConfirmDescription")}
                      confirmLabel={t("revoke")}
                      pendingLabel={t("revoking")}
                      onConfirm={() => revokeKey({ keyId: apiKey.id })}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {apiKey.scopes.map((scope) => (
                  <Badge key={scope} variant="secondary" className="font-mono text-xs">
                    {scope}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {t("revocationDelayNote", { minutes: Math.ceil(API_KEY_CACHE_TTL_SECONDS / 60) })}
      </p>
    </div>
  );
}
