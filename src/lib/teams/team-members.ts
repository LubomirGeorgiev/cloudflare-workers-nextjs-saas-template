import "server-only";
import { cache } from "react";
import { isTeamOwnerRole, TEAM_PERMISSIONS } from "@/constants/team-roles";
import { getDB } from "@/db";
import { teamInvitationTable, teamMembershipTable } from "@/db/schema";
import { requireVerifiedEmail } from "@/utils/auth";
import { ActionError } from "@/lib/action-error";
import { eq, and, isNull, sql } from "drizzle-orm";
import { requireTeamPermission } from "@/utils/team-auth";
import { getActiveTeamMembership, isMembershipCurrentlyActive } from "@/utils/team-membership";
import { requireNormalizedSessionEmail } from "@/utils/session-user";
import { updateAllSessionsOfUser } from "@/utils/kv-session";
import { normalizeEmail } from "@/lib/validation";
import { getTeamSeatUsage } from "@/lib/teams/team-seats";
import { getTeamRowEntitlements } from "@/utils/entitlements";

export const getTeamMemberManagementData = cache(async (teamId: string) => {
  const session = await requireTeamPermission(teamId, TEAM_PERMISSIONS.ACCESS_DASHBOARD);

  const db = getDB();
  const currentMembership = await getActiveTeamMembership({ teamId, userId: session.userId });

  // Pending invitations expose invitee PII (email, role, expiry). Only viewers who can manage
  // invitations may see them — gated on the same INVITE_MEMBERS permission that creates and
  // revokes them. Unauthorized viewers still see the member roster but never the invite list,
  // so we skip the query entirely for them rather than fetch-then-drop.
  const canManageInvitations = Boolean(
    currentMembership?.permissions.includes(TEAM_PERMISSIONS.INVITE_MEMBERS),
  );

  const [members, invitationsAndSeats, teamRoles] = await Promise.all([
    db.query.teamMembershipTable.findMany({
      where: { teamId: teamId },
      with: {
        user: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatar: true,
          }
        }
      },
    }),
    canManageInvitations ? getPendingInvitationsAndSeats(teamId) : Promise.resolve(null),
    db.query.teamRoleTable.findMany({
      where: { teamId: teamId },
    }),
  ]);

  // Map roles by ID for easy lookup
  const roleMap = new Map(teamRoles.map(role => [role.id, role.name]));

  const memberEntries = members.map(member => {
    // Custom roles carry their user-defined name; system roles return null and
    // get a localized label at the render site from `roleId` + `isSystemRole`.
    const roleName = member.isSystemRole ? null : (roleMap.get(member.roleId) ?? null);

    return {
      id: member.id,
      userId: member.userId,
      roleId: member.roleId,
      roleName,
      isSystemRole: Boolean(member.isSystemRole),
      isActive: Boolean(member.isActive),
      joinedAt: member.joinedAt ? new Date(member.joinedAt) : null,
      user: {
        id: member.user.id,
        firstName: member.user.firstName,
        lastName: member.user.lastName,
        email: member.user.email,
        avatar: member.user.avatar,
      }
    };
  });

  const pendingInvitations = invitationsAndSeats?.pendingInvitations ?? [];
  const invitationEntries = pendingInvitations.map(invitation => ({
    id: invitation.id,
    email: invitation.email,
    roleId: invitation.roleId,
    roleName: invitation.isSystemRole ? null : (roleMap.get(invitation.roleId) ?? null),
    isSystemRole: Boolean(invitation.isSystemRole),
    createdAt: new Date(invitation.createdAt),
    expiresAt: new Date(invitation.expiresAt),
  }));

  return {
    // Revoking is gated on the same INVITE_MEMBERS permission as viewing the list above, so a
    // viewer who sees pending invitations can always act on them.
    canRevokeInvitations: canManageInvitations,
    // Seat usage is only for inviters, the same viewers as the pending list it counts.
    seatUsage: invitationsAndSeats
      ? getTeamSeatUsage({
          activeMembers: members.filter((member) => isMembershipCurrentlyActive(member)).length,
          pendingInvitations: pendingInvitations.length,
          seats: invitationsAndSeats.seats,
        })
      : null,
    members: memberEntries,
    pendingInvitations: invitationEntries,
  };
});

export async function removeTeamMember({
  teamId,
  userId
}: {
  teamId: string;
  userId: string;
}) {
  await requireTeamPermission(teamId, TEAM_PERMISSIONS.REMOVE_MEMBERS);

  return deleteTeamMembership({ teamId, userId });
}

// Leaving needs ACCESS_DASHBOARD, the same gate as the team page that shows the button.
// The owner rule in deleteTeamMembership keeps the owner in.
export async function leaveTeam(teamId: string) {
  const session = await requireTeamPermission(teamId, TEAM_PERMISSIONS.ACCESS_DASHBOARD);

  return deleteTeamMembership({ teamId, userId: session.userId });
}

// The removal itself, minus the team-permission check: an admin acting from the user detail page
// is authorized by their system role, not by a membership they do not have. Owner protection is
// part of the operation, not of the check, so it applies to both callers.
//
// Carries no authorization of its own: only call it behind one.
export async function deleteTeamMembership({
  teamId,
  userId
}: {
  teamId: string;
  userId: string;
}) {
  const db = getDB();

  const membership = await db.query.teamMembershipTable.findFirst({
    where: {
      teamId,
      userId,
    },
    with: {
      user: { columns: { email: true } },
    },
  });

  if (!membership) {
    throw new ActionError("NOT_FOUND", { key: "Client.Dashboard.Teams.errorMembershipNotFound" });
  }

  // Don't allow removing an owner
  if (isTeamOwnerRole(membership)) {
    throw new ActionError("FORBIDDEN", { key: "Client.Dashboard.Teams.errorCannotRemoveOwner" });
  }

  const deleteMembership = db.delete(teamMembershipTable)
    .where(
      and(
        eq(teamMembershipTable.teamId, teamId),
        eq(teamMembershipTable.userId, userId)
      )
    );
  const memberEmail = membership.user.email;

  // A pending invitation to the member's own address would let them accept their way back in.
  // One batch, so a failure cannot leave the member removed while that invitation still works.
  if (memberEmail) {
    await db.batch([
      deleteMembership,
      db.delete(teamInvitationTable)
        .where(pendingInvitationsForEmail({ teamId, email: memberEmail })),
    ]);
  } else {
    await deleteMembership;
  }

  await updateAllSessionsOfUser(userId);

  return { success: true };
}

export async function getPendingInvitationsForCurrentUser() {
  // requireVerifiedEmail throws without a verified session, so it always returns one here.
  const session = await requireVerifiedEmail();

  // Reject a missing session email explicitly rather than dropping the email predicate, which
  // would fail open and list every team's pending invitations.
  const email = requireNormalizedSessionEmail(session);

  const db = getDB();

  const invitations = await db.query.teamInvitationTable.findMany({
    where: {
      email,
      acceptedAt: { isNull: true },
      expiresAt: { gt: new Date() },
    },
    with: {
      team: {
        columns: {
          id: true,
          name: true,
          slug: true,
          avatarUrl: true,
        }
      },
      invitedByUser: {
        columns: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          avatar: true,
        }
      }
    },
  });

  // Explicit DTO. The bearer token / token hash is deliberately never returned; the dashboard
  // accepts by invitation id.
  return invitations.map(invitation => ({
    id: invitation.id,
    teamId: invitation.teamId,
    team: {
      id: invitation.team.id,
      name: invitation.team.name,
      slug: invitation.team.slug,
      avatarUrl: invitation.team.avatarUrl,
    },
    roleId: invitation.roleId,
    isSystemRole: Boolean(invitation.isSystemRole),
    createdAt: new Date(invitation.createdAt),
    expiresAt: invitation.expiresAt ? new Date(invitation.expiresAt) : null,
    invitedBy: {
      id: invitation.invitedByUser.id,
      firstName: invitation.invitedByUser.firstName,
      lastName: invitation.invitedByUser.lastName,
      email: invitation.invitedByUser.email,
      avatar: invitation.invitedByUser.avatar,
    }
  }));
}

// Legacy invitation rows can hold mixed case or spaces, so compare the normalized column.
function pendingInvitationsForEmail({ teamId, email }: { teamId: string; email: string }) {
  return and(
    eq(teamInvitationTable.teamId, teamId),
    isNull(teamInvitationTable.acceptedAt),
    sql`lower(trim(${teamInvitationTable.email})) = ${normalizeEmail(email)}`,
  );
}

// The same pending filter and seat source as the invite gate (`withinSeatCap` in ./team-writes.ts).
// tests/integration/team-seat-usage.test.ts pins the pair.
async function getPendingInvitationsAndSeats(teamId: string) {
  const db = getDB();

  const [pendingInvitations, team] = await Promise.all([
    db.query.teamInvitationTable.findMany({
      where: {
        teamId,
        acceptedAt: { isNull: true },
        expiresAt: { gt: new Date() },
      },
      columns: {
        id: true,
        email: true,
        roleId: true,
        isSystemRole: true,
        createdAt: true,
        expiresAt: true,
      },
    }),
    db.query.teamTable.findFirst({
      where: { id: teamId },
      columns: {
        subscriptionPlanId: true,
        subscriptionStatus: true,
        planExpiresAt: true,
        subscriptionAddonIds: true,
        limitOverrides: true,
      },
    }),
  ]);

  if (!team) {
    throw new ActionError("NOT_FOUND", { key: "Client.Dashboard.Teams.errorTeamNotFound" });
  }

  return { pendingInvitations, seats: getTeamRowEntitlements(team).limits.seats };
}
