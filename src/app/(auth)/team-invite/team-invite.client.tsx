"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAction } from "next-safe-action/hooks";
import { acceptTeamInviteAction } from "./team-invite.action";
import { teamInviteSchema } from "@/schemas/team-invite.schema";
import { Spinner } from "@/components/ui/spinner";

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (isExecuting) {
    return (
      <div className="container mx-auto px-4 flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex flex-col items-center space-y-4">
              <Spinner size="large" />
              <CardTitle>Accepting Invitation</CardTitle>
              <CardDescription>
                Please wait while we process your team invitation...
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invitation Error</CardTitle>
            <CardDescription>
              {error?.message || "Failed to process the invitation"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {error?.code === "CONFLICT"
                ? "You are already a member of this team."
                : error?.code === "FORBIDDEN" && error?.message.includes("limit")
                ? "You've reached the maximum number of teams you can join."
                : "The invitation may have expired or been revoked."}
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => router.push("/dashboard")}
            >
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="container mx-auto px-4 flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invalid Invitation Link</CardTitle>
            <CardDescription>
              The invitation link is invalid or has expired.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => router.push("/dashboard")}
            >
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
