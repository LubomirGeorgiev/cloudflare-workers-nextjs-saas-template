"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { useAction } from "next-safe-action/hooks";
import { acceptTeamInviteAction } from "./team-invite.action";
import { teamInviteSchema } from "@/schemas/team-membership.schema";
import { Spinner } from "@/components/ui/spinner";
import { AuthStatusCard } from "@/app/[locale]/(auth)/_components/auth-status-card";
import { v } from "@/lib/validation";
import { useTranslations } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import useSignOut from "@/hooks/useSignOut";
import { getTeamInviteSignInPath } from "@/lib/teams/team-invite-links";

const WRONG_EMAIL_ERROR_KEY = "Client.Dashboard.Teams.errorInvitationWrongEmail";
const EMAIL_VERIFICATION_REQUIRED_ERROR_KEY = "Client.Errors.emailVerificationRequired";
const EXPIRED_OR_REVOKED_ERROR_KEYS = new Set([
  "Client.Dashboard.Teams.errorInvitationNotFound",
  "Client.Dashboard.Teams.errorInvitationExpired",
]);

export default function TeamInviteClientComponent({ currentEmail }: { currentEmail: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const hasCalledAcceptInvite = useRef(false);
  const t = useTranslations("Client.Auth.TeamInvite");

  const { execute: handleAcceptInvite, isExecuting, result } = useAction(acceptTeamInviteAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message || t("toastAcceptError"));
    },
    onExecute: () => {
      toast.loading(t("toastProcessing"));
    },
    onSuccess: ({ data }) => {
      toast.dismiss();
      toast.success(t("toastAcceptSuccess"));

      router.refresh();

      // Team detail routes are slug-based. Keep the database ID out of the URL.
      setTimeout(() => {
        if (
          data
          && typeof data === "object"
          && "teamSlug" in data
          && typeof data.teamSlug === "string"
        ) {
          router.push(`/dashboard/teams/${encodeURIComponent(data.teamSlug)}`);
        } else {
          router.push("/dashboard");
        }
      }, 500);
    },
  });
  const error = result.serverError;

  useEffect(() => {
    if (token && !hasCalledAcceptInvite.current) {
      const result = v.safeParse(teamInviteSchema, { token });
      if (result.success) {
        hasCalledAcceptInvite.current = true;
        handleAcceptInvite(result.output);
      } else {
        toast.error(t("toastInvalidToken"));
        router.push("/sign-in");
      }
    }
  }, [token]);

  if (isExecuting) {
    return (
      <AuthStatusCard
        title={t("acceptingTitle")}
        description={t("acceptingDescription")}
        headerClassName="text-center"
        headerContent={<Spinner size="large" />}
      />
    );
  }

  if (error && token && error.reason === WRONG_EMAIL_ERROR_KEY) {
    return <WrongAccountCard message={error.message} currentEmail={currentEmail} token={token} />;
  }

  if (error) {
    const hintKey = getErrorHintKey(error);

    return (
      <AuthStatusCard
        title={t("errorTitle")}
        description={error.message || t("errorDescriptionFallback")}
        actionLabel={t("goToDashboard")}
        onAction={() => router.push("/dashboard")}
        contentClassName="flex flex-col gap-4"
      >
        {hintKey && <p className="text-sm text-muted-foreground">{t(hintKey)}</p>}
      </AuthStatusCard>
    );
  }

  if (!token) {
    return (
      <AuthStatusCard
        title={t("invalidLinkTitle")}
        description={t("invalidLinkDescription")}
        actionLabel={t("goToDashboard")}
        onAction={() => router.push("/dashboard")}
      />
    );
  }

  return null;
}

function WrongAccountCard({
  message,
  currentEmail,
  token,
}: {
  message: string;
  currentEmail: string | null;
  token: string;
}) {
  const router = useRouter();
  const { signOut } = useSignOut();
  const t = useTranslations("Client.Auth.TeamInvite");

  return (
    <AuthStatusCard
      title={t("errorTitle")}
      description={message}
      actionLabel={t("goToDashboard")}
      onAction={() => router.push("/dashboard")}
      contentClassName="flex flex-col gap-4"
    >
      {currentEmail && (
        <p className="text-sm text-muted-foreground">
          {t("errorWrongAccount", { email: currentEmail })}
        </p>
      )}
      <Button
        className="w-full"
        onClick={() => void signOut({ redirectTo: getTeamInviteSignInPath(token) })}
      >
        {t("signOutAndContinue")}
      </Button>
    </AuthStatusCard>
  );
}

// Each hint names one cause, so it shows only for the errors that have that cause.
function getErrorHintKey(error: { code: string; reason?: string }) {
  if (error.code === "CONFLICT") {
    return "errorAlreadyMember";
  }

  if (error.reason === "Client.Dashboard.Teams.errorJoinLimit") {
    return "errorTeamLimitReached";
  }

  if (error.reason && EXPIRED_OR_REVOKED_ERROR_KEYS.has(error.reason)) {
    return "errorExpiredOrRevoked";
  }

  // verify-email.client.tsx has no return path to this page, so the user must open the link again.
  if (error.reason === EMAIL_VERIFICATION_REQUIRED_ERROR_KEY) {
    return "errorVerifyEmailFirst";
  }

  return null;
}
