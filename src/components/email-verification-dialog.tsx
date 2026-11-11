"use client";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSessionStore } from "@/state/session";
import { useAction } from "next-safe-action/hooks";
import { sendVerificationAction } from "@/app/[locale]/(auth)/send-verification.action";
import { toast } from "sonner";
import { useState } from "react";
import { EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS } from "@/constants";
import { isLocalMode } from "@/utils/is-local";
import { usePathname } from "@/i18n/navigation";
import { Route } from "next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useTranslations } from "@/i18n/client";
import useSignOut from "@/hooks/useSignOut";

const pagesToBypass: Route[] = [
  "/verify-email",
  "/sign-in",
  "/sign-up",
  "/",
  "/privacy",
  "/terms",
  "/reset-password",
  "/forgot-password"
];

export function EmailVerificationDialog() {
  const { session } = useSessionStore();
  const [lastVerificationEmailSentAt, setLastVerificationEmailSentAt] = useState<number | null>(null);
  // Locale-stripped pathname so bypass matches work under `/es/...` prefixes.
  const pathname = usePathname();
  const t = useTranslations("Client.Auth.EmailVerificationDialog");
  const { signOut } = useSignOut();

  const { execute: sendVerification, status } = useAction(sendVerificationAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message);
    },
    onExecute: () => {
      toast.loading(t("toastSending"));
    },
    onSuccess: () => {
      toast.dismiss();
      toast.success(t("toastSent"));
      setLastVerificationEmailSentAt(Date.now());
    },
  });

  // Don't show the dialog if the user is not logged in, if their email is already verified,
  // or if we're on the verify-email page
  if (
    !session
    || session.user.emailVerified
    || pagesToBypass.includes(pathname)
  ) {
    return null;
  }

  const canSendAgain = !lastVerificationEmailSentAt || Date.now() - lastVerificationEmailSentAt > 60000; // 1 minute cooldown
  const isLoading = status === "executing";
  const expirationHours = Math.floor(EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS / 3600);

  // An alert dialog has no close control: the user leaves the gate by verifying or signing out.
  return (
    <AlertDialog open>
      <AlertDialogContent className="w-[calc(100%-2rem)] sm:max-w-md max-h-screen overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("description", { email: session.user.email ?? "", hours: expirationHours })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {isLocalMode && (
          <Alert>
            <AlertTitle>{t("devModeTitle")}</AlertTitle>
            <AlertDescription>
              {t("devModeDescription")}
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-4">
          <Button
            onClick={() => sendVerification({ returnTo: `${pathname}${window.location.search}` })}
            disabled={isLoading || !canSendAgain}
          >
            {isLoading
              ? t("sending")
              : !canSendAgain
                ? t("cooldown")
                : t("resend")}
          </Button>
          <p className="text-sm text-muted-foreground">{t("spamHint")}</p>
          <p className="text-sm text-muted-foreground">{t("wrongEmailHint")}</p>
          <Button variant="outline" onClick={() => void signOut()}>
            {t("signOut")}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
