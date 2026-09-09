"use client";

import { KeyRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { revokeApiKeyAction } from "@/actions/api-key-actions";
import { ApiScopeDisclosure } from "@/components/api-scope-disclosure";
import { CreateApiKeyDialog } from "@/components/api-keys/create-api-key-dialog";
import { EditApiKeyScopesDialog } from "@/components/api-keys/edit-api-key-scopes-dialog";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
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
        // One ledger, not a stack of cards: a key is a row, and the rows share one border so the
        // eye reads the list as an inventory rather than as separate panels competing for weight.
        <ul className="divide-y rounded-lg border bg-card text-card-foreground">
          {apiKeys.map((apiKey) => (
            <li key={apiKey.id} className="space-y-3 p-5 sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="truncate font-semibold leading-tight">{apiKey.name}</h3>
                    <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {formatApiKeyHint({ keyPrefix: apiKey.keyPrefix, last4: apiKey.last4 })}
                    </code>
                  </div>
                  <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
                  </p>
                </div>

                {/* Quiet by default: only the row's own name and reach should carry weight. */}
                <div className="-ml-3 flex shrink-0 gap-1 sm:-mr-2 sm:-mt-1 sm:ml-0">
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
                </div>
              </div>

              <ApiScopeDisclosure scopes={apiKey.scopes} teamId={apiKey.teamId} />
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        {t("revocationDelayNote", { minutes: Math.ceil(API_KEY_CACHE_TTL_SECONDS / 60) })}
      </p>
    </div>
  );
}
