"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSessionStore } from "@/state/session";
import { useAction } from "next-safe-action/hooks";
import { sendVerificationAction } from "@/app/[locale]/(auth)/send-verification.action";
import { toast } from "sonner";
import { useState } from "react";
import { EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS } from "@/constants";
import { isLocalhost } from "@/utils/is-local";
import { usePathname } from "@/i18n/navigation";
import { Route } from "next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useTranslations } from "next-intl";

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
    || pagesToBypass.includes(pathname as Route)
  ) {
    return null;
  }

  const canSendAgain = !lastVerificationEmailSentAt || Date.now() - lastVerificationEmailSentAt > 60000; // 1 minute cooldown
  const isLoading = status === "executing";
  const expirationHours = Math.floor(EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS / 3600);

  return (
    <Dialog open modal onOpenChange={(newState) => {
      if (newState === false) {
        toast.warning(t("toastCloseWarning"));
      }
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { email: session.user.email ?? "", hours: expirationHours })}

            {isLocalhost && (
              <Alert className="mt-4 mb-2">
                <AlertTitle>{t("devModeTitle")}</AlertTitle>
                <AlertDescription>
                  {t("devModeDescription")}
                </AlertDescription>
              </Alert>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Button
            onClick={() => sendVerification()}
            disabled={isLoading || !canSendAgain}
          >
            {isLoading
              ? t("sending")
              : !canSendAgain
                ? t("cooldown")
                : t("resend")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
