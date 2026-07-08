"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useAction } from "next-safe-action/hooks";
import { acceptTeamInviteAction } from "./team-invite.action";
import { teamInviteSchema } from "@/schemas/team-invite.schema";
import { Spinner } from "@/components/ui/spinner";
import { AuthStatusCard } from "@/app/[locale]/(auth)/_components/auth-status-card";
import { v } from "@/lib/validation";
import { useTranslations } from "next-intl";

export default function TeamInviteClientComponent() {
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

      // Redirect to the team dashboard, with fallback to general dashboard
      setTimeout(() => {
        if (data && typeof data === "object" && "teamId" in data) {
          router.push(`/dashboard/teams/${data.teamId}`);
        } else {
          // Fallback to dashboard if teamId is not found
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

  if (error) {
    return (
      <AuthStatusCard
        title={t("errorTitle")}
        description={error?.message || t("errorDescriptionFallback")}
        actionLabel={t("goToDashboard")}
        onAction={() => router.push("/dashboard")}
        contentClassName="flex flex-col gap-4"
      >
        <p className="text-sm text-muted-foreground">
          {error?.code === "CONFLICT"
            ? t("errorAlreadyMember")
            : error?.code === "FORBIDDEN" && error?.message.includes("limit")
            ? t("errorTeamLimitReached")
            : t("errorExpiredOrRevoked")}
        </p>
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
