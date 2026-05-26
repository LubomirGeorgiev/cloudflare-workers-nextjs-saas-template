"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useAction } from "next-safe-action/hooks";
import { googleSSOCallbackAction } from "./google-callback.action";
import { googleSSOCallbackSchema } from "@/schemas/google-sso-callback.schema";
import { Spinner } from "@/components/ui/spinner";
import { REDIRECT_AFTER_SIGN_IN } from "@/constants";
import { AuthStatusCard } from "@/app/(auth)/_components/auth-status-card";
import { v } from "@/lib/validation";
import { useManagedLoadingToast } from "@/hooks/use-managed-loading-toast";

export default function GoogleCallbackClientComponent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const hasCalledCallback = useRef(false);
  const { dismissLoadingToast, showLoadingToast } = useManagedLoadingToast();

  const { execute: handleCallback, isExecuting, result } = useAction(googleSSOCallbackAction, {
    onError: ({ error }) => {
      dismissLoadingToast();
      toast.error(error.serverError?.message || "Failed to sign in with Google");
    },
    onExecute: () => {
      showLoadingToast("Signing you in with Google...");
    },
    onSuccess: () => {
      dismissLoadingToast();
      toast.success("Signed in successfully");
      window.location.href = REDIRECT_AFTER_SIGN_IN;
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
        toast.error("Invalid callback parameters");
        router.push("/sign-in");
      }
    }
  }, [code, state]);

  if (isExecuting) {
    return (
      <AuthStatusCard
        title="Signing in with Google"
        description="Please wait while we complete your sign in..."
        headerClassName="text-center"
        headerContent={<Spinner size="large" />}
      />
    );
  }

  if (error) {
    return (
      <AuthStatusCard
        title="Sign in failed"
        description={error?.message || "Failed to sign in with Google"}
        actionLabel="Back to sign in"
        onAction={() => router.push("/sign-in")}
      />
    );
  }

  return (
    <AuthStatusCard
      title="Invalid callback"
      description="The sign in callback is invalid or has expired. Please try signing in again."
      actionLabel="Back to sign in"
      onAction={() => router.push("/sign-in")}
    />
  );
}
