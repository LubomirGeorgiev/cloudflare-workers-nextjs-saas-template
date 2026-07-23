import "server-only";
import { getDB } from "@/db";
import { TEAM_PERMISSIONS, teamInvitationTable } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { eq, and, isNull } from "drizzle-orm";
import { requireTeamPermission } from "@/utils/team-auth";

// Revoking a pending invitation is gated on INVITE_MEMBERS — the same permission that creates
// invitations — so anyone who can invite can also revoke, and no one else can. This keeps the
// policy symmetric with creation and aligned with the TEAM_PERMISSIONS model rather than a
// bespoke owner-only check.
export async function revokeTeamInvitation({
  teamId,
  invitationId,
}: {
  teamId: string;
  invitationId: string;
}) {
  await requireTeamPermission(teamId, TEAM_PERMISSIONS.INVITE_MEMBERS);

  const db = getDB();
  const revokedInvitations = await db.delete(teamInvitationTable)
    .where(and(
      eq(teamInvitationTable.id, invitationId),
      eq(teamInvitationTable.teamId, teamId),
      isNull(teamInvitationTable.acceptedAt),
    ))
    .returning({ id: teamInvitationTable.id });

  if (revokedInvitations.length === 0) {
    throw new ActionError("NOT_FOUND", {
      key: "Client.Dashboard.Teams.errorInvitationNotFound",
    });
  }

  return { success: true } as const;
}
