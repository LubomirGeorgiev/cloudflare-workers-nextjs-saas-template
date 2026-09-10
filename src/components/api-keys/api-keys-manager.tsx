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
import { CredentialLedger, CredentialRow } from "@/components/credentials/credential-ledger";
import { EmptyStateCard } from "@/components/empty-state-card";
import { Button } from "@/components/ui/button";
import { API_DOCS_PATH, API_KEY_CACHE_TTL_SECONDS } from "@/constants";
// The reference lives under `app/[locale]`, so it needs the locale-prefixing Link.
import { Link } from "@/i18n/navigation";
import type { PublicApiKeySummary } from "@/lib/api-keys/api-keys";
import { formatApiKeyHint } from "@/utils/api-key-format";
import { formatDate } from "@/utils/format-date";

interface ApiKeysManagerProps {
  apiKeys: PublicApiKeySummary[];
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
          <p className="max-w-prose text-sm text-muted-foreground">
            {t.rich(teamId ? "teamDescription" : "description", {
              link: (chunks) => (
                <Link
                  href={API_DOCS_PATH}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  {chunks}
                </Link>
              ),
            })}
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
        <CredentialLedger>
          {apiKeys.map((apiKey) => (
            <CredentialRow
              key={apiKey.id}
              title={apiKey.name}
              titleBadge={
                <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  {formatApiKeyHint({ keyPrefix: apiKey.keyPrefix, last4: apiKey.last4 })}
                </code>
              }
              facts={[
                t("createdLabel", { date: formatDate(apiKey.createdAt, locale) }),
                apiKey.lastUsedAt
                  ? t("lastUsedLabel", { date: formatDate(apiKey.lastUsedAt, locale) })
                  : t("lastUsedNever"),
                apiKey.expiresAt
                  ? t("expiresLabel", { date: formatDate(apiKey.expiresAt, locale) })
                  : t("expiresNever"),
              ]}
              actions={
                <>
                  <EditApiKeyScopesDialog apiKey={apiKey} />

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
                    onConfirm={() => revokeKey({ keyId: apiKey.id })}
                  />
                </>
              }
              scopes={apiKey.scopes}
              scopeTeamId={apiKey.teamId}
            />
          ))}
        </CredentialLedger>
      )}

      <p className="text-xs text-muted-foreground">
        {t("revocationDelayNote", { minutes: Math.ceil(API_KEY_CACHE_TTL_SECONDS / 60) })}
      </p>
    </div>
  );
}
