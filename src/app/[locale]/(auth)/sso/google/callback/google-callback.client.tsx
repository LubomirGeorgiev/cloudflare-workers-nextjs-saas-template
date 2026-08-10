"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { useAction } from "next-safe-action/hooks";
import { googleSSOCallbackAction } from "./google-callback.action";
import { googleSSOCallbackSchema } from "@/schemas/google-sso-callback.schema";
import { Spinner } from "@/components/ui/spinner";
import { AuthStatusCard } from "@/app/[locale]/(auth)/_components/auth-status-card";
import { v } from "@/lib/validation";
import { useManagedLoadingToast } from "@/hooks/use-managed-loading-toast";
import { useNavigateAfterAuth } from "@/hooks/use-navigate-after-auth";
import { useTranslations } from "next-intl";

export default function GoogleCallbackClientComponent() {
  const router = useRouter();
  const navigateAfterAuth = useNavigateAfterAuth();
  const searchParams = useSearchParams();
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const hasCalledCallback = useRef(false);
  const { dismissLoadingToast, showLoadingToast } = useManagedLoadingToast();
  const t = useTranslations("Client.Auth.GoogleCallback");
  const tCommon = useTranslations("Client.Auth.Common");

  const { execute: handleCallback, isExecuting, result } = useAction(googleSSOCallbackAction, {
    onError: ({ error }) => {
      dismissLoadingToast();
      toast.error(error.serverError?.message || t("failedDescriptionFallback"));
    },
    onExecute: () => {
      showLoadingToast(t("toastSigningIn"));
    },
    onSuccess: () => {
      dismissLoadingToast();
      toast.success(t("toastSignInSuccess"));
      navigateAfterAuth();
    },
  });
  const error = result.serverError;

  useEffect(() => {
    if (code && state && !hasCalledCallback.current) {
      const result = v.safeParse(googleSSOCallbackSchema, { code, state });
      if (result.success) {
        hasCalledCallback.current = true;
        handleCallback(result.output);
      } else {
        toast.error(t("toastInvalidParams"));
        router.push("/sign-in");
      }
    }
  }, [code, state]);

  if (isExecuting) {
    return (
      <AuthStatusCard
        title={t("signingInTitle")}
        description={t("signingInDescription")}
        headerClassName="text-center"
        headerContent={<Spinner size="large" />}
      />
    );
  }

  if (error) {
    return (
      <AuthStatusCard
        title={t("failedTitle")}
        description={error?.message || t("failedDescriptionFallback")}
        actionLabel={tCommon("backToSignIn")}
        onAction={() => router.push("/sign-in")}
      />
    );
  }

  return (
    <AuthStatusCard
      title={t("invalidCallbackTitle")}
      description={t("invalidCallbackDescription")}
      actionLabel={tCommon("backToSignIn")}
      onAction={() => router.push("/sign-in")}
    />
  );
}
