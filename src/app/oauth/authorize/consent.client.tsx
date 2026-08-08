"use client";

import { AlertTriangle, BadgeCheck, ShieldQuestion } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { signOutAction } from "@/actions/sign-out.action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { OAUTH_AUTHORIZE_PATH } from "@/constants";
import { API_SCOPES, type ApiScope } from "@/lib/api/scopes";
import { cn } from "@/lib/utils";
import { decideConsentAction } from "./authorize.actions";

interface ConsentClientProps {
  authQuery: string;
  clientName: string | null;
  logoUri: string | null;
  isVerified: boolean;
  grantedScopes: ApiScope[];
  droppedScopes: string[];
  redirectHost: string | null;
  cimdHost: string | null;
  userEmail: string;
}

function isWriteScope(scope: string): boolean {
  return !scope.endsWith(":read");
}

export function ConsentClient({
  authQuery,
  clientName,
  logoUri,
  isVerified,
  grantedScopes,
  droppedScopes,
  redirectHost,
  cimdHost,
  userEmail,
}: ConsentClientProps) {
  const t = useTranslations("Client.OAuth");
  const tScopes = useTranslations("Client.ApiScopes");
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
  const readScopes = grantedScopes.filter((scope) => !isWriteScope(scope));
  const writeScopes = grantedScopes.filter(isWriteScope);
  // The combination the anti-phishing controls exist for: nobody has vouched for this app and it
  // is asking to change things.
  const isRisky = !isVerified && writeScopes.length > 0;

  // Falls back to the machine-facing catalog description, same as the API-key scope picker.
  function describeScope(scope: ApiScope): string {
    return tScopes.has(scope) ? tScopes(scope) : API_SCOPES[scope].description;
  }

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

        <div className="space-y-4">
          <p className="text-sm font-medium">{t("permissionsTitle")}</p>
          <ScopeGroup label={t("readGroup")} scopes={readScopes} describe={describeScope} />
          <ScopeGroup label={t("writeGroup")} scopes={writeScopes} describe={describeScope} />
          {grantedScopes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noScopes")}</p>
          ) : null}
        </div>

        {droppedScopes.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("clampedScopes", { scopes: droppedScopes.join(", ") })}
          </p>
        ) : null}

        <dl className="space-y-1 text-xs text-muted-foreground">
          <HostRow label={t("redirectLabel")} host={redirectHost} />
          <HostRow label={t("cimdLabel")} host={cimdHost} />
        </dl>

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

/** Shown so the user can see which domain the approval actually hands the code to. */
function HostRow({ label, host }: { label: string; host: string | null }) {
  if (!host) {
    return null;
  }

  return (
    <div className="flex justify-between gap-2">
      <dt>{label}</dt>
      <dd className="font-mono">{host}</dd>
    </div>
  );
}

function ScopeGroup({
  label,
  scopes,
  describe,
}: {
  label: string;
  scopes: ApiScope[];
  describe: (scope: ApiScope) => string;
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
