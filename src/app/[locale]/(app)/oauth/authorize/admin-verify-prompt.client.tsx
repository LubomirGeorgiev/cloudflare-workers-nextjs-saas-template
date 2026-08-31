"use client";

import { ShieldCheck } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { verifyConsentClientAction } from "./authorize.actions";

/**
 * Shown only to an admin, and only when verifying the client is the single thing standing between
 * this request and its internal scopes. Verification is a deployment-wide decision, so the copy
 * says so plainly — but the decision belongs here, at the moment an admin is being asked to hand
 * this client administrative access, rather than on a page they have to go and find.
 */
export function AdminVerifyPrompt({
  authQuery,
  clientName,
  scopes,
  describe,
  disabled,
}: {
  authQuery: string;
  clientName: string;
  scopes: string[];
  describe: (scope: string) => string;
  disabled: boolean;
}) {
  const t = useTranslations("Client.OAuth");
  // Refresh only, so it stays on `next/navigation`: there is no route to localize here.
  const router = useRouter();

  const { execute, status } = useAction(verifyConsentClientAction, {
    onSuccess: () => {
      toast.success(t("adminVerifyToastSuccess"));
      // Re-renders the page so the clamp re-runs server-side and the scopes appear as granted.
      router.refresh();
    },
    onError: ({ error }) => {
      toast.error(error.serverError?.message ?? t("adminVerifyToastError"));
    },
  });

  const isVerifying = status === "executing";

  return (
    <div className="space-y-3 rounded-md border border-amber-500/60 bg-amber-500/10 p-3 text-sm">
      <div className="flex gap-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <div className="space-y-1">
          <p className="font-medium">{t("adminVerifyTitle", { app: clientName })}</p>
          <p>{t("adminVerifyBody", { app: clientName })}</p>
        </div>
      </div>

      <ul className="space-y-1 pl-7">
        {scopes.map((scope) => (
          <li key={scope}>
            <span className="font-mono text-xs">{scope}</span>
            <span className="block text-xs text-muted-foreground">{describe(scope)}</span>
          </li>
        ))}
      </ul>

      <div className="pl-7">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || isVerifying}
          onClick={() => execute({ authQuery })}
        >
          {isVerifying ? <Spinner className="mr-2 size-4" /> : null}
          {t("adminVerifyButton")}
        </Button>
      </div>
    </div>
  );
}
