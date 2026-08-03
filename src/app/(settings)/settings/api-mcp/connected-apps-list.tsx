"use client";

import { BadgeCheck, Plug, ShieldQuestion } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { EmptyStateCard } from "@/components/empty-state-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isApiScope } from "@/lib/api/scopes";
import type { ConnectedApp } from "@/lib/oauth/connected-apps";
import { formatDate } from "@/utils/format-date";
import { revokeConnectedAppAction } from "./api-mcp.actions";

// Scopes read `resource:action`; brightening the action is what a user scans for when deciding
// whether a grant is safe. Unknown shapes (no colon) render whole.
function ScopeToken({ scope }: { scope: string }) {
  const separator = scope.lastIndexOf(":");

  return (
    <span className="font-mono text-[11px] leading-none text-muted-foreground/70">
      {separator === -1 ? scope : scope.slice(0, separator + 1)}
      {separator === -1 ? null : (
        <span className="font-medium text-foreground/70">{scope.slice(separator + 1)}</span>
      )}
    </span>
  );
}

export function ConnectedAppsList({ apps }: { apps: ConnectedApp[] }) {
  const t = useTranslations("Client.Settings.ConnectedApps");
  const tScopes = useTranslations("Client.OAuth.Scopes");
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

  // A grant can outlive the scope it was issued with (a fork may drop one), so an unknown name
  // still renders — as itself — rather than blowing up the page.
  function describeScope(scope: string): string {
    return isApiScope(scope) && tScopes.has(scope) ? tScopes(scope) : scope;
  }

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
                <ul className="mt-3 grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                  {app.scopes.map((scope) => (
                    <li key={scope} className="flex flex-col gap-1">
                      <ScopeToken scope={scope} />
                      <span className="text-sm leading-snug">{describeScope(scope)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
