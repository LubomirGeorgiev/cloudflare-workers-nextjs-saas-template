"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, CheckCircle } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import {
  getPendingInvitationsForCurrentUserAction,
  acceptInvitationAction
} from "@/actions/team-membership-actions";
import type { getPendingInvitationsForCurrentUser } from "@/lib/teams/team-members";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

// Derive the DTO from the server function so the shape stays in sync automatically.
// Type-only import from a server-only module is erased at compile time.
type PendingInvitation = Awaited<ReturnType<typeof getPendingInvitationsForCurrentUser>>[number];

export function PendingInvitations() {
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const router = useRouter();
  const t = useTranslations("Client.Dashboard.Teams");

  const { execute: fetchPendingInvitations } = useAction(getPendingInvitationsForCurrentUserAction, {
    onSuccess: ({ data }) => {
      if (data?.success && data.data) {
        setPendingInvitations(data.data);
      }
    },
    onError: ({ error }) => {
      console.error("Failed to fetch pending invitations:", error);
      toast.error(error.serverError?.message || t("fetchInvitationsError"));
    }
  });

  const acceptAction = useAction(acceptInvitationAction, {
    onSuccess: ({ input }) => {
      toast.success(t("joinedTeamSuccess"));

      // Remove from pending list
      setPendingInvitations(prev => prev.filter(inv => inv.id !== input.invitationId));

      // Refresh the page to show the new team
      router.refresh();
    },
    onError: ({ error }) => {
      toast.error(error.serverError?.message || t("acceptInvitationError"));
    }
  });

  useEffect(() => {
    fetchPendingInvitations();
  }, [fetchPendingInvitations]);

  if (pendingInvitations.length === 0) {
    return null; // Don't show anything while loading or if no pending invitations
  }

  return (
    <Card className="mb-8 border-orange-200 dark:border-orange-900 bg-orange-50 dark:bg-orange-950/20">
      <CardHeader>
        <CardTitle className="text-xl">{t("pendingInvitationsTitle")}</CardTitle>
        <CardDescription>
          {t("pendingInvitationsDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pendingInvitations.map((invitation) => {
          const isAccepting =
            acceptAction.isExecuting && acceptAction.input?.invitationId === invitation.id;

          return (
            <div key={invitation.id} className="flex items-center justify-between p-3 bg-background rounded-md border">
              <div className="flex items-center gap-3">
                {invitation.team.avatarUrl ? (
                  <div className="h-10 w-10 rounded-md overflow-hidden">
                    {/* oxlint-disable-next-line nextjs/no-img-element */}
                    <img
                      src={invitation.team.avatarUrl}
                      alt={`${invitation.team.name} logo`}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                    <Users className="h-5 w-5" />
                  </div>
                )}
                <div>
                  <h3 className="font-medium">{invitation.team.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t("invitedBy", { name: `${invitation.invitedBy.firstName || ''} ${invitation.invitedBy.lastName || ''}`.trim() })}
                  </p>
                </div>
              </div>
              <Button
                onClick={() => acceptAction.execute({ invitationId: invitation.id })}
                disabled={isAccepting}
                size="sm"
              >
                {isAccepting ? (
                  t("accepting")
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    {t("accept")}
                  </>
                )}
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
