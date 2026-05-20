"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, CheckCircle } from "lucide-react";
import {
  getPendingInvitationsForCurrentUserAction,
  acceptInvitationAction
} from "@/actions/team-membership-actions";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface PendingInvitation {
  id: string;
  token: string;
  teamId: string;
  team: {
    id: string;
    name: string;
    slug: string;
    avatarUrl: string | null;
  };
  roleId: string;
  isSystemRole: boolean;
  createdAt: Date;
  expiresAt: Date | null;
  invitedBy: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    avatar: string | null;
  };
}

export function PendingInvitations() {
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState<Record<string, boolean>>({});
  const router = useRouter();

  useEffect(() => {
    const fetchPendingInvitations = async () => {
      setIsLoading(true);
      try {
        const { data: result } = await getPendingInvitationsForCurrentUserAction();

        if (result?.success && result.data) {
          setPendingInvitations(result.data as PendingInvitation[]);
        }
      } catch (err) {
        console.error("Failed to fetch pending invitations:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPendingInvitations();
  }, []);

  const handleAccept = async (token: string) => {
    setIsAccepting(prev => ({ ...prev, [token]: true }));

    try {
      const { data: result, serverError } = await acceptInvitationAction({ token });

      if (serverError) {
        throw new Error(serverError.message);
      }

      if (result?.success) {
        toast.success("You have successfully joined the team");

        // Remove from pending list
        setPendingInvitations(prev => prev.filter(inv => inv.token !== token));

        // Refresh the page to show the new team
        router.refresh();
      }
    } catch {
      toast.error("Failed to accept invitation");
    } finally {
      setIsAccepting(prev => ({ ...prev, [token]: false }));
    }
  };

  if (isLoading) {
    return null; // Don't show anything while loading
  }

  if (pendingInvitations.length === 0) {
    return null; // Don't show anything if no pending invitations
  }

  return (
    <Card className="mb-8 border-orange-200 dark:border-orange-900 bg-orange-50 dark:bg-orange-950/20">
      <CardHeader>
        <CardTitle className="text-xl">Pending Team Invitations</CardTitle>
        <CardDescription>
          You have been invited to join the following teams
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pendingInvitations.map((invitation) => (
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
                  Invited by {invitation.invitedBy.firstName || ''} {invitation.invitedBy.lastName || ''}
                </p>
              </div>
            </div>
            <Button
              onClick={() => handleAccept(invitation.token)}
              disabled={isAccepting[invitation.token]}
              size="sm"
            >
              {isAccepting[invitation.token] ? (
                "Accepting..."
              ) : (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Accept
                </>
              )}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
