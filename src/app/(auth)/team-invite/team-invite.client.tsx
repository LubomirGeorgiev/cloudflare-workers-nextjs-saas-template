"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useAction } from "next-safe-action/hooks";
import { acceptTeamInviteAction } from "./team-invite.action";
import { teamInviteSchema } from "@/schemas/team-invite.schema";
import { Spinner } from "@/components/ui/spinner";
import { AuthStatusCard } from "@/app/(auth)/_components/auth-status-card";

export default function TeamInviteClientComponent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const hasCalledAcceptInvite = useRef(false);

  const { execute: handleAcceptInvite, isExecuting, result } = useAction(acceptTeamInviteAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message || "Failed to accept team invitation");
    },
    onExecute: () => {
      toast.loading("Processing your invitation...");
    },
    onSuccess: ({ data }) => {
      toast.dismiss();
      toast.success("You've successfully joined the team!");

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
      const result = teamInviteSchema.safeParse({ token });
      if (result.success) {
        hasCalledAcceptInvite.current = true;
        handleAcceptInvite(result.data);
      } else {
        toast.error("Invalid invitation token");
        router.push("/sign-in");
      }
    }
  }, [token]);

  if (isExecuting) {
    return (
      <AuthStatusCard
        title="Accepting Invitation"
        description="Please wait while we process your team invitation..."
        headerClassName="text-center"
        headerContent={<Spinner size="large" />}
      />
    );
  }

  if (error) {
    return (
      <AuthStatusCard
        title="Invitation Error"
        description={error?.message || "Failed to process the invitation"}
        actionLabel="Go to Dashboard"
        onAction={() => router.push("/dashboard")}
        contentClassName="flex flex-col gap-4"
      >
        <p className="text-sm text-muted-foreground">
          {error?.code === "CONFLICT"
            ? "You are already a member of this team."
            : error?.code === "FORBIDDEN" && error?.message.includes("limit")
            ? "You've reached the maximum number of teams you can join."
            : "The invitation may have expired or been revoked."}
        </p>
      </AuthStatusCard>
    );
  }

  if (!token) {
    return (
      <AuthStatusCard
        title="Invalid Invitation Link"
        description="The invitation link is invalid or has expired."
        actionLabel="Go to Dashboard"
        onAction={() => router.push("/dashboard")}
      />
    );
  }

  return null;
}
