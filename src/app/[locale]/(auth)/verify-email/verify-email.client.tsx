"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { useAction } from "next-safe-action/hooks";
import { verifyEmailAction } from "./verify-email.action";
import { verifyEmailSchema } from "@/schemas/verify-email.schema";
import { Spinner } from "@/components/ui/spinner";
import { AuthStatusCard } from "@/app/[locale]/(auth)/_components/auth-status-card";
import { v } from "@/lib/validation";
import { useManagedLoadingToast } from "@/hooks/use-managed-loading-toast";
import { useNavigateAfterAuth } from "@/hooks/use-navigate-after-auth";
import { useTranslations } from "@/i18n/client";

export default function VerifyEmailClientComponent() {
  const router = useRouter();
  const navigateAfterAuth = useNavigateAfterAuth();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const hasCalledVerification = useRef(false);
  const { dismissLoadingToast, showLoadingToast } = useManagedLoadingToast();
  const t = useTranslations("Client.Auth.VerifyEmail");
  const tCommon = useTranslations("Client.Auth.Common");

  const { execute: handleVerification, isExecuting, result } = useAction(verifyEmailAction, {
    onError: ({ error }) => {
      dismissLoadingToast();
      toast.error(error.serverError?.message || t("toastVerifyFailed"));
    },
    onExecute: () => {
      showLoadingToast(t("toastVerifying"));
    },
    onSuccess: ({ data }) => {
      dismissLoadingToast();
      toast.success(t("toastVerifySuccess"));

      // Not a bare push: pages without a SessionHydrator need the store that
      // `useNavigateAfterAuth` loads, or they keep `emailVerified: false`.
      navigateAfterAuth({ redirectPath: data?.returnTo });
    },
  });
  const error = result.serverError;

  useEffect(() => {
    if (token && !hasCalledVerification.current) {
      const result = v.safeParse(verifyEmailSchema, { token });
      if (result.success) {
        hasCalledVerification.current = true;
        handleVerification(result.output);
      } else {
        toast.error(t("toastInvalidToken"));
        router.push("/sign-in");
      }
    }
  }, [token]);

  if (isExecuting) {
    return (
      <AuthStatusCard
        title={t("verifyingTitle")}
        description={t("verifyingDescription")}
        headerClassName="text-center"
        headerContent={<Spinner size="large" />}
      />
    );
  }

  if (error) {
    return (
      <AuthStatusCard
        title={t("failedTitle")}
        description={error?.message || t("failedDescription")}
        actionLabel={tCommon("backToSignIn")}
        onAction={() => router.push("/sign-in")}
      />
    );
  }

  if (!token) {
    return (
      <AuthStatusCard
        title={t("invalidLinkTitle")}
        description={t("invalidLinkDescription")}
        actionLabel={tCommon("backToSignIn")}
        onAction={() => router.push("/sign-in")}
      />
    );
  }

  return null;
}
