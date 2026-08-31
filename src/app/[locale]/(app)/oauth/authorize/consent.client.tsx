"use client";

import { AlertTriangle, BadgeCheck, MonitorSmartphone, ShieldQuestion } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { signOutAction } from "@/actions/sign-out.action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { OAUTH_AUTHORIZE_PATH } from "@/constants";
import { API_SCOPES, isApiScope } from "@/lib/api/scopes";
import { cn } from "@/lib/utils";
import { AdminVerifyPrompt } from "./admin-verify-prompt.client";
import { decideConsentAction } from "./authorize.actions";

interface ConsentClientProps {
  authQuery: string;
  clientName: string | null;
  logoUri: string | null;
  isVerified: boolean;
  grantedScopes: string[];
  droppedScopes: string[];
  /** Copy for internal scopes; the internal catalog is `server-only` and cannot be imported here. */
  adminScopeDescriptions: Record<string, string>;
  /** Scopes an admin would unlock by verifying this client; null when there is nothing to offer. */
  adminScopesToVerify: string[] | null;
  redirectHost: string | null;
  cimdHost: string | null;
  clientId: string;
  isLoopbackRedirect: boolean;
  userEmail: string;
}

function isWriteScope(scope: string): boolean {
  return !scope.endsWith(":read");
}

/**
 * Copy for one scope, wherever it comes from. Translated where the public catalog has an entry,
 * falling back to that catalog's machine-facing description like the API-key scope picker does.
 *
 * An internal scope has no entry here at all: `@/lib/api/admin-scopes` is `server-only` and must
 * never reach a client bundle, so its copy arrives as a prop resolved on the server.
 */
function useScopeDescriber(adminScopeDescriptions: Record<string, string>) {
  const tScopes = useTranslations("Client.ApiScopes");

  return function describeScope(scope: string): string {
    if (adminScopeDescriptions[scope]) {
      return adminScopeDescriptions[scope];
    }

    if (!isApiScope(scope)) {
      return scope;
    }

    return tScopes.has(scope) ? tScopes(scope) : API_SCOPES[scope].description;
  };
}

export function ConsentClient({
  authQuery,
  clientName,
  logoUri,
  isVerified,
  grantedScopes,
  droppedScopes,
  adminScopeDescriptions,
  adminScopesToVerify,
  redirectHost,
  cimdHost,
  clientId,
  isLoopbackRedirect,
  userEmail,
}: ConsentClientProps) {
  const t = useTranslations("Client.OAuth");
  const [isLeaving, setIsLeaving] = useState(false);

  const { execute, status } = useAction(decideConsentAction, {
    onSuccess: ({ data }) => {
      if (!data?.redirectTo) {
        return;
      }
      setIsLeaving(true);
      window.location.replace(data.redirectTo);
    },
    onError: ({ error }) => {
      toast.error(error.serverError?.message ?? t("toastDecisionError"));
    },
  });

  const isBusy = status === "executing" || isLeaving;
  // The combination the anti-phishing controls exist for: nobody has vouched for this app and it
  // is asking to change things.
  const isRisky = !isVerified && grantedScopes.some(isWriteScope);

  const describeScope = useScopeDescriber(adminScopeDescriptions);

  async function switchAccount() {
    setIsLeaving(true);
    await signOutAction();
    const returnTo = `${OAUTH_AUTHORIZE_PATH}?${authQuery}`;
    window.location.replace(`/sign-in?redirect=${encodeURIComponent(returnTo)}`);
  }

  return (
    <Card className={cn("w-full", isRisky && "border-destructive/60")}>
      <ConsentHeader clientName={clientName} logoUri={logoUri} isVerified={isVerified} />

      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          {t("signedInAs", { email: userEmail })}{" "}
          <button
            type="button"
            onClick={switchAccount}
            disabled={isBusy}
            className="underline underline-offset-4 hover:no-underline"
          >
            {t("switchAccount")}
          </button>
        </p>

        <ConsentIdentity
          cimdHost={cimdHost}
          clientId={clientId}
          clientName={clientName}
          isLoopbackRedirect={isLoopbackRedirect}
          isRisky={isRisky}
          redirectHost={redirectHost}
        />

        {adminScopesToVerify ? (
          <AdminVerifyPrompt
            authQuery={authQuery}
            clientName={clientName ?? t("unknownApp")}
            scopes={adminScopesToVerify}
            describe={describeScope}
            disabled={isBusy}
          />
        ) : null}

        <ConsentPermissions
          grantedScopes={grantedScopes}
          droppedScopes={droppedScopes}
          describe={describeScope}
        />

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            className="sm:flex-1"
            disabled={isBusy}
            onClick={() => execute({ authQuery, decision: "approve" })}
          >
            {isBusy ? <Spinner className="mr-2 size-4" /> : null}
            {t("approve")}
          </Button>
          <Button
            variant="outline"
            className="sm:flex-1"
            disabled={isBusy}
            onClick={() => execute({ authQuery, decision: "deny" })}
          >
            {t("deny")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ConsentHeader({
  clientName,
  logoUri,
  isVerified,
}: {
  clientName: string | null;
  logoUri: string | null;
  isVerified: boolean;
}) {
  const t = useTranslations("Client.OAuth");

  return (
    <CardHeader className="items-center gap-3 text-center">
      {logoUri ? (
        // Third-party asset on an arbitrary domain: a plain img keeps it out of the image
        // optimizer, which would otherwise fetch and cache whatever a self-registered app points at.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUri}
          alt=""
          className="size-12 rounded-lg object-contain"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <CardTitle className="text-xl">
        {t("title", { app: clientName ?? t("unknownApp") })}
      </CardTitle>
      <Badge variant={isVerified ? "default" : "secondary"} className="gap-1">
        {isVerified ? <BadgeCheck className="size-3.5" /> : <ShieldQuestion className="size-3.5" />}
        {isVerified ? t("verifiedBadge") : t("unverifiedBadge")}
      </Badge>
    </CardHeader>
  );
}

/** Shown so the user can see who asked and which domain the approval hands the code to. */
function IdentityRow({ label, value }: { label: string; value: string | null }) {
  if (!value) {
    return null;
  }

  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all text-right font-mono text-xs">{value}</dd>
    </div>
  );
}

function ScopeGroup({
  label,
  scopes,
  describe,
}: {
  label: string;
  scopes: string[];
  describe: (scope: string) => string;
}) {
  if (scopes.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul className="space-y-2">
        {scopes.map((scope) => (
          <li key={scope} className="text-sm">
            <span className="block font-mono text-xs text-muted-foreground">{scope}</span>
            {describe(scope)}
          </li>
        ))}
      </ul>
    </div>
  );
}


/** What the app will be able to do, and what was asked for but clamped away. */
function ConsentPermissions({
  grantedScopes,
  droppedScopes,
  describe,
}: {
  grantedScopes: string[];
  droppedScopes: string[];
  describe: (scope: string) => string;
}) {
  const t = useTranslations("Client.OAuth");
  const readScopes = grantedScopes.filter((scope) => !isWriteScope(scope));
  const writeScopes = grantedScopes.filter(isWriteScope);

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium">{t("permissionsTitle")}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {t("permissionCount", {
              granted: grantedScopes.length,
              requested: grantedScopes.length + droppedScopes.length,
            })}
          </p>
        </div>
        <ScopeGroup label={t("readGroup")} scopes={readScopes} describe={describe} />
        <ScopeGroup label={t("writeGroup")} scopes={writeScopes} describe={describe} />
        {/* Only when nothing was asked for. When everything was clamped away the line below says
            so by name, and "none requested" would be plainly untrue. */}
        {grantedScopes.length === 0 && droppedScopes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noScopes")}</p>
        ) : null}
      </div>

      {droppedScopes.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("clampedScopes", { scopes: droppedScopes.join(", ") })}
        </p>
      ) : null}
    </>
  );
}


/** Who is asking and where the code would land — the strongest anti-phishing signals, plus their warnings. */
function ConsentIdentity({
  cimdHost,
  clientId,
  clientName,
  isLoopbackRedirect,
  isRisky,
  redirectHost,
}: {
  cimdHost: string | null;
  clientId: string;
  clientName: string | null;
  isLoopbackRedirect: boolean;
  isRisky: boolean;
  redirectHost: string | null;
}) {
  const t = useTranslations("Client.OAuth");

  return (
    <>
      <dl className="divide-y overflow-hidden rounded-md border text-sm">
        <IdentityRow label={t("clientIdHostLabel")} value={cimdHost} />
        {/* A DCR client has no domain to show, so name it by the id it registered under. */}
        <IdentityRow label={t("clientIdLabel")} value={cimdHost ? null : clientId} />
        <IdentityRow label={t("redirectHostLabel")} value={redirectHost} />
      </dl>

      {isLoopbackRedirect ? (
        <Alert variant="warning">
          <MonitorSmartphone className="size-4" />
          <AlertDescription>{t("localRedirectWarning")}</AlertDescription>
        </Alert>
      ) : null}

      {isRisky ? (
        <div className="flex gap-3 rounded-md border border-destructive/60 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="space-y-1">
            <p className="font-medium">
              {t("unverifiedWarningTitle", { app: clientName ?? t("unknownApp") })}
            </p>
            <p>{t("unverifiedWarningBody")}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
