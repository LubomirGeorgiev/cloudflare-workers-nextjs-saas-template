"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useAction } from "next-safe-action/hooks";
import { verifyEmailAction } from "./verify-email.action";
import { verifyEmailSchema } from "@/schemas/verify-email.schema";
import { Spinner } from "@/components/ui/spinner";
import { REDIRECT_AFTER_SIGN_IN } from "@/constants";
import { AuthStatusCard } from "@/app/(auth)/_components/auth-status-card";
import { v } from "@/lib/validation";

export default function VerifyEmailClientComponent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const hasCalledVerification = useRef(false);

  const { execute: handleVerification, isExecuting, result } = useAction(verifyEmailAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message || "Failed to verify email");
    },
    onExecute: () => {
      toast.loading("Verifying your email...");
    },
    onSuccess: () => {
      // TODO(vinext): Keep client-side navigation here until
      // cloudflare/vinext#654 and cloudflare/vinext#1347 are fixed, then
      // remove the matching server-action redirect guard from the auth pages.
      toast.dismiss();
      toast.success("Email verified successfully");

      router.refresh();

      setTimeout(() => {
        router.push(REDIRECT_AFTER_SIGN_IN);
      }, 500);
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
        toast.error("Invalid verification token");
        router.push("/sign-in");
      }
    }
  }, [token]);

  if (isExecuting) {
    return (
      <AuthStatusCard
        title="Verifying Email"
        description="Please wait while we verify your email address..."
        headerClassName="text-center"
        headerContent={<Spinner size="large" />}
      />
    );
  }

  if (error) {
    return (
      <AuthStatusCard
        title="Verification failed"
        description={error?.message || "Failed to verify email"}
        actionLabel="Back to sign in"
        onAction={() => router.push("/sign-in")}
      />
    );
  }

  if (!token) {
    return (
      <AuthStatusCard
        title="Invalid verification link"
        description="The verification link is invalid. Please request a new verification email."
        actionLabel="Back to sign in"
        onAction={() => router.push("/sign-in")}
      />
    );
  }

  return null;
}
