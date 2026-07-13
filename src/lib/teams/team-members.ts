import "server-only";
import { cache } from "react";
import { getDB } from "@/db";
import { SYSTEM_ROLES_ENUM, TEAM_PERMISSIONS, teamInvitationTable, teamMembershipTable } from "@/db/schema";
import { canSignUp, getSessionFromCookie } from "@/utils/auth";
import { ActionError } from "@/lib/action-error";
import { createId } from "@paralleldrive/cuid2";
import { eq, and, count, gt, isNull } from "drizzle-orm";
import { requireTeamPermission } from "@/utils/team-auth";
import { updateAllSessionsOfUser, type KVSession } from "@/utils/kv-session";
import { MAX_TEAMS_JOINED_PER_USER } from "@/constants";
import { sendTeamInvitationEmail } from "@/utils/email";
import { getTranslations } from "next-intl/server";
import { getUserLocale } from "@/i18n/locale";
import { getTeamEntitlements } from "@/utils/entitlements";

const DEFAULT_INVITATION_ROLE_ID = SYSTEM_ROLES_ENUM.MEMBER;

interface ResolvedInvitationRole {
  roleId: string;
  isSystemRole: boolean;
  permissions: string[];
}

function getSystemRolePermissions(roleId: string): string[] {
  if (roleId === SYSTEM_ROLES_ENUM.ADMIN) {
    return Object.values(TEAM_PERMISSIONS);
  }

  if (roleId === SYSTEM_ROLES_ENUM.MEMBER) {
    return [
      TEAM_PERMISSIONS.ACCESS_DASHBOARD,
      TEAM_PERMISSIONS.CREATE_COMPONENTS,
      TEAM_PERMISSIONS.EDIT_COMPONENTS,
    ];
  }

  if (roleId === SYSTEM_ROLES_ENUM.GUEST) {
    return [
      TEAM_PERMISSIONS.ACCESS_DASHBOARD,
    ];
  }

  throw new ActionError("BAD_REQUEST", "Invalid team role");
}

async function resolveInvitationRole({
  db,
  teamId,
  roleId,
  isSystemRole,
}: {
  db: ReturnType<typeof getDB>;
  teamId: string;
  roleId: string;
  isSystemRole: boolean;
}): Promise<ResolvedInvitationRole> {
  if (isSystemRole) {
    if (roleId === SYSTEM_ROLES_ENUM.OWNER) {
      throw new ActionError("FORBIDDEN", "Team owners cannot be assigned through invitations");
    }

    return {
      roleId,
      isSystemRole: true,
      permissions: getSystemRolePermissions(roleId),
    };
  }

  const role = await db.query.teamRoleTable.findFirst({
    where: {
      id: roleId,
      teamId,
    },
  });

  if (!role) {
    throw new ActionError("NOT_FOUND", "Team role not found");
  }

  return {
    roleId: role.id,
    isSystemRole: false,
    permissions: role.permissions,
  };
}

function requirePermissionToAssignRole({
  session,
  teamId,
  role,
}: {
  session: KVSession;
  teamId: string;
  role: ResolvedInvitationRole;
}) {
  if (role.isSystemRole && role.roleId === DEFAULT_INVITATION_ROLE_ID) {
    return;
  }

  const team = session.teams?.find((sessionTeam) => sessionTeam.id === teamId);
  const permissions = new Set(team?.permissions ?? []);
  const canAssignRoles = permissions.has(TEAM_PERMISSIONS.ASSIGN_ROLES)
    || permissions.has(TEAM_PERMISSIONS.CHANGE_MEMBER_ROLES);

  if (!canAssignRoles) {
    throw new ActionError("FORBIDDEN", "You don't have permission to assign this role");
  }

  const canGrantRolePermissions = role.permissions.every((permission) => permissions.has(permission));

  if (!canGrantRolePermissions) {
    throw new ActionError("FORBIDDEN", "You cannot assign a role with permissions you do not have");
  }
}

export const getTeamMembers = cache(async (teamId: string) => {
  await requireTeamPermission(teamId, TEAM_PERMISSIONS.ACCESS_DASHBOARD);

  const db = getDB();

  const members = await db.query.teamMembershipTable.findMany({
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
  });

  const teamRoles = await db.query.teamRoleTable.findMany({
    where: { teamId: teamId },
  });

  // Map roles by ID for easy lookup
  const roleMap = new Map(teamRoles.map(role => [role.id, role.name]));

  return Promise.all(members.map(async member => {
    let roleName = "Unknown";

    // For system roles, use the roleId directly as the name
    if (member.isSystemRole) {
      // Capitalize the first letter for display
      roleName = member.roleId.charAt(0).toUpperCase() + member.roleId.slice(1);
    } else {
      // For custom roles, look up the name in our roleMap
      roleName = roleMap.get(member.roleId) || "Custom Role";
    }

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
  }));
});

export async function removeTeamMember({
  teamId,
  userId
}: {
  teamId: string;
  userId: string;
}) {
  await requireTeamPermission(teamId, TEAM_PERMISSIONS.REMOVE_MEMBERS);

  const db = getDB();

  const membership = await db.query.teamMembershipTable.findFirst({
    where: {
      teamId,
      userId,
    },
  });

  if (!membership) {
    throw new ActionError("NOT_FOUND", "Team membership not found");
  }

  // Don't allow removing an owner
  if (membership.roleId === SYSTEM_ROLES_ENUM.OWNER && membership.isSystemRole) {
    throw new ActionError("FORBIDDEN", "Cannot remove the team owner");
  }

  await db.delete(teamMembershipTable)
    .where(
      and(
        eq(teamMembershipTable.teamId, teamId),
        eq(teamMembershipTable.userId, userId)
      )
    );

  await updateAllSessionsOfUser(userId);

  return { success: true };
}

export async function inviteUserToTeam({
  teamId,
  email,
  roleId,
  isSystemRole = true
}: {
  teamId: string;
  email: string;
  roleId: string;
  isSystemRole?: boolean;
}) {
  const session = await requireTeamPermission(teamId, TEAM_PERMISSIONS.INVITE_MEMBERS);

  if (!session) {
    throw new ActionError("NOT_AUTHORIZED", "Not authenticated");
  }

  try {
    await canSignUp({ email });
  } catch (error) {
    if (error instanceof ActionError) {
      throw error;
    }
    throw new ActionError("ERROR", "Invalid or disposable email address");
  }

  const db = getDB();
  const invitationRole = await resolveInvitationRole({
    db,
    teamId,
    roleId,
    isSystemRole,
  });

  requirePermissionToAssignRole({
    session,
    teamId,
    role: invitationRole,
  });

  const team = await db.query.teamTable.findFirst({
    where: { id: teamId },
  });

  if (!team) {
    throw new ActionError("NOT_FOUND", "Team not found");
  }

  // Seat-cap gate: enforce the team plan's seat limit at this grow point. Counts current
  // members plus outstanding invitations. Limits are enforced only when growing — a team
  // already over a lowered cap keeps its members (never auto-evicted).
  const { limits } = getTeamEntitlements({
    planId: team.subscriptionPlanId,
    subscriptionStatus: team.subscriptionStatus,
    planExpiresAt: team.planExpiresAt,
  });

  const [memberCountResult, pendingInvitesResult] = await Promise.all([
    db.select({ value: count() })
      .from(teamMembershipTable)
      .where(eq(teamMembershipTable.teamId, teamId)),
    db.select({ value: count() })
      .from(teamInvitationTable)
      .where(and(
        eq(teamInvitationTable.teamId, teamId),
        isNull(teamInvitationTable.acceptedAt),
        // Expired invites must not consume seats (mirrors getPendingInvitationsForCurrentUser).
        gt(teamInvitationTable.expiresAt, new Date()),
      )),
  ]);

  const seatsInUse = (memberCountResult[0]?.value || 0) + (pendingInvitesResult[0]?.value || 0);

  if (seatsInUse >= limits.seats) {
    const t = await getTranslations("Client.Dashboard.Teams");
    throw new ActionError("FORBIDDEN", t("seatLimitReached", { seats: limits.seats }));
  }

  const teamName = team.name as string || "Team";

  const inviter = {
    firstName: session.user.firstName || "",
    lastName: session.user.lastName || "",
    fullName: `${session.user.firstName || ""} ${session.user.lastName || ""}`.trim() || session.user.email,
  };

  // The invitee may not have an account yet, so there's no preferredLocale to
  // read - use the inviter's locale instead (request-scoped: cookie ->
  // preferredLocale -> Accept-Language -> default).
  const inviterLocale = await getUserLocale();

  const existingUser = await db.query.userTable.findFirst({
    where: { email: email },
  });

  if (existingUser) {
    const existingMembership = await db.query.teamMembershipTable.findFirst({
      where: {
        teamId,
        userId: existingUser.id,
      },
    });

    if (existingMembership) {
      throw new ActionError("CONFLICT", "User is already a member of this team");
    }

    const teamsCountResult = await db.select({ value: count() })
      .from(teamMembershipTable)
      .where(eq(teamMembershipTable.userId, existingUser.id));

    const teamsJoined = teamsCountResult[0]?.value || 0;

    if (teamsJoined >= MAX_TEAMS_JOINED_PER_USER) {
      throw new ActionError("FORBIDDEN", `This user has reached the limit of ${MAX_TEAMS_JOINED_PER_USER} teams they can join.`);
    }

    // User exists but is not a member, add them directly
    await db.insert(teamMembershipTable).values({
      teamId,
      userId: existingUser.id,
      roleId: invitationRole.roleId,
      isSystemRole: invitationRole.isSystemRole ? 1 : 0,
      invitedBy: session.userId,
      invitedAt: new Date(),
      joinedAt: new Date(),
      isActive: 1,
    });

    await updateAllSessionsOfUser(existingUser.id);

    return {
      success: true,
      userJoined: true,
      userId: existingUser.id,
    };
  }

  // User doesn't exist, create an invitation
  const token = createId();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // Valid for 7 days

  const existingInvitation = await db.query.teamInvitationTable.findFirst({
    where: {
      teamId,
      email,
    },
  });

  if (existingInvitation) {
    await db.update(teamInvitationTable)
      .set({
        roleId: invitationRole.roleId,
        isSystemRole: invitationRole.isSystemRole ? 1 : 0,
        token,
        expiresAt,
        invitedBy: session.userId,
        acceptedAt: null,
        acceptedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(teamInvitationTable.id, existingInvitation.id));

    // Send invitation email
    await sendTeamInvitationEmail({
      email,
      invitationToken: token,
      teamName,
      inviterName: inviter.fullName || "Team Owner",
      locale: inviterLocale,
    });

    return {
      success: true,
      invitationSent: true,
      invitationId: existingInvitation.id,
    };
  }

  const newInvitation = await db.insert(teamInvitationTable).values({
    teamId,
    email,
    roleId: invitationRole.roleId,
    isSystemRole: invitationRole.isSystemRole ? 1 : 0,
    token,
    invitedBy: session.userId,
    expiresAt,
  }).returning();

  const invitation = newInvitation?.[0];

  if (!invitation) {
    throw new ActionError("ERROR", "Could not create invitation");
  }

  // Send invitation email
  await sendTeamInvitationEmail({
    email,
    invitationToken: token,
    teamName,
    inviterName: inviter.fullName || "Team Owner",
    locale: inviterLocale,
  });

  return {
    success: true,
    invitationSent: true,
    invitationId: invitation.id,
  };
}

export async function acceptTeamInvitation(token: string) {
  const session = await getSessionFromCookie();

  if (!session) {
    throw new ActionError("NOT_AUTHORIZED", "Not authenticated");
  }

  const db = getDB();

  // Find the invitation by token
  const invitation = await db.query.teamInvitationTable.findFirst({
    where: { token: token },
  });

  if (!invitation) {
    throw new ActionError("NOT_FOUND", "Invitation not found");
  }

  if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
    throw new ActionError("ERROR", "Invitation has expired");
  }

  if (invitation.acceptedAt) {
    throw new ActionError("CONFLICT", "Invitation has already been accepted");
  }

  if (session.user.email !== invitation.email) {
    throw new ActionError("FORBIDDEN", "This invitation is for a different email address");
  }

  const existingMembership = await db.query.teamMembershipTable.findFirst({
    where: {
      teamId: invitation.teamId,
      userId: session.userId,
    },
  });

  if (existingMembership) {
    // Mark invitation as accepted
    await db.update(teamInvitationTable)
      .set({
        acceptedAt: new Date(),
        acceptedBy: session.userId,
        updatedAt: new Date(),
      })
      .where(eq(teamInvitationTable.id, invitation.id));

    throw new ActionError("CONFLICT", "You are already a member of this team");
  }

  const teamsCountResult = await db.select({ value: count() })
    .from(teamMembershipTable)
    .where(eq(teamMembershipTable.userId, session.userId));

  const teamsJoined = teamsCountResult[0]?.value || 0;

  if (teamsJoined >= MAX_TEAMS_JOINED_PER_USER) {
    throw new ActionError("FORBIDDEN", `You have reached the limit of ${MAX_TEAMS_JOINED_PER_USER} teams you can join.`);
  }

  const invitationRole = await resolveInvitationRole({
    db,
    teamId: invitation.teamId,
    roleId: invitation.roleId,
    isSystemRole: Boolean(invitation.isSystemRole),
  });

  await db.insert(teamMembershipTable).values({
    teamId: invitation.teamId,
    userId: session.userId,
    roleId: invitationRole.roleId,
    isSystemRole: invitationRole.isSystemRole ? 1 : 0,
    invitedBy: invitation.invitedBy,
    invitedAt: invitation.createdAt ? new Date(invitation.createdAt) : new Date(),
    joinedAt: new Date(),
    isActive: 1,
  });

  // Mark invitation as accepted
  await db.update(teamInvitationTable)
    .set({
      acceptedAt: new Date(),
      acceptedBy: session.userId,
      updatedAt: new Date(),
    })
    .where(eq(teamInvitationTable.id, invitation.id));

  await updateAllSessionsOfUser(session.userId);

  return {
    success: true,
    teamId: invitation.teamId,
  };
}

export async function getPendingInvitationsForCurrentUser() {
  const session = await getSessionFromCookie();

  if (!session) {
    throw new ActionError("NOT_AUTHORIZED", "Not authenticated");
  }

  const db = getDB();

  const invitations = await db.query.teamInvitationTable.findMany({
    where: {
      ...(session.user.email ? { email: session.user.email } : {}),
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

  return invitations.map(invitation => ({
    id: invitation.id,
    token: invitation.token,
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
