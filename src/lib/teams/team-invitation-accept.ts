import "server-only";
import { getDB } from "@/db";
import { teamInvitationTable } from "@/db/schema";
import { requireVerifiedEmail } from "@/utils/auth";
import { ActionError } from "@/lib/action-error";
import { eq, and, isNull } from "drizzle-orm";
import { isMembershipCurrentlyActive, getActiveTeamMembership } from "@/utils/team-membership";
import { requireNormalizedSessionEmail } from "@/utils/session-user";
import { updateAllSessionsOfUser } from "@/utils/kv-session";
import type { CurrentSession } from "@/types";
import { MAX_TEAMS_JOINED_PER_USER } from "@/constants";
import { hashInvitationToken } from "@/lib/teams/invitation-tokens";
import { normalizeEmail } from "@/lib/validation";
import { assertEmailNotBlocked } from "@/lib/auth/blocked-email-guard";
import { createRandomId } from "@/utils/random-token";
import {
  buildInvitationAcceptance,
  buildMembershipInsert,
  buildMembershipReactivation,
  didInsert,
  isUniqueConstraintError,
  toUnixSeconds,
  withinJoinedTeamCap,
} from "@/lib/teams/team-writes";
import { resolveInvitationRole } from "@/lib/teams/team-invitation-roles";

// Minimal shape the acceptance flow needs from an invitation row, decoupled from the drizzle
// query result so both accept paths (email-link token, dashboard-by-id) share one core.
interface AcceptableInvitation {
  id: string;
  teamId: string;
  email: string;
  roleId: string;
  isSystemRole: number;
  invitedBy: string;
  createdAt: Date;
  expiresAt: Date | null;
  acceptedAt: Date | null;
  team: {
    slug: string;
  };
}

// Shared acceptance core. Assumes the caller already resolved the invitation and holds a
// verified-email session. Guards, capacity enforcement, and the atomic write live here so no
// accept path can skip them. Membership is created + invitation marked accepted in a single
// atomic D1 batch with the joined-team cap enforced in the insert itself.
async function acceptResolvedInvitation({
  invitation,
  session,
}: {
  invitation: AcceptableInvitation;
  session: CurrentSession;
}) {
  const db = getDB();

  if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
    throw new ActionError("ERROR", { key: "Client.Dashboard.Teams.errorInvitationExpired" });
  }

  if (invitation.acceptedAt) {
    throw new ActionError("CONFLICT", { key: "Client.Dashboard.Teams.errorInvitationAlreadyAccepted" });
  }

  // Reject a missing session email explicitly instead of the previous fail-open.
  const sessionEmail = requireNormalizedSessionEmail(session);

  if (sessionEmail !== normalizeEmail(invitation.email)) {
    throw new ActionError("FORBIDDEN", { key: "Client.Dashboard.Teams.errorInvitationWrongEmail" });
  }

  // Belt and braces for a pattern added after the invitation went out. The invite path writes no
  // row for a blocked address, so this only ever catches an entry created in between.
  await assertEmailNotBlocked({
    email: sessionEmail,
    messageKey: "Client.Dashboard.Teams.errorInvitationEmailNotAllowed",
  });

  const existingMembership = await db.query.teamMembershipTable.findFirst({
    where: {
      teamId: invitation.teamId,
      userId: session.userId,
    },
  });

  if (existingMembership) {
    const membershipIsActive = isMembershipCurrentlyActive({
      isActive: existingMembership.isActive,
      expiresAt: existingMembership.expiresAt,
    });

    if (membershipIsActive) {
      // Genuinely already an active member -> mark the invitation accepted (idempotent cleanup)
      // and report. The (teamId, userId) unique index below is the real duplicate guard.
      await db.update(teamInvitationTable)
        .set({
          acceptedAt: new Date(),
          acceptedBy: session.userId,
          updatedAt: new Date(),
        })
        .where(and(
          eq(teamInvitationTable.id, invitation.id),
          isNull(teamInvitationTable.acceptedAt),
        ));

      throw new ActionError("CONFLICT", { key: "Client.Dashboard.Teams.errorAlreadyOnTeam" });
    }

    // Inactive/expired membership grants no access (requireTeamAccess 404s such users), so
    // throwing "already on team" would strand the invitee forever. The (teamId, userId) unique
    // index forbids a second row, so reactivate the existing one under the invitation's role
    // rather than inserting, and mark the invitation accepted.
    const reactivationRole = await resolveInvitationRole({
      db,
      teamId: invitation.teamId,
      roleId: invitation.roleId,
      isSystemRole: Boolean(invitation.isSystemRole),
    });
    const reactivatedAt = new Date();
    const nowSec = toUnixSeconds(reactivatedAt);
    const d1 = db.$client;
    const reactivateMembership = buildMembershipReactivation(
      d1,
      {
        teamId: invitation.teamId,
        userId: session.userId,
        roleId: reactivationRole.roleId,
        isSystemRole: reactivationRole.isSystemRole,
        invitationId: invitation.id,
        nowSec,
      },
      withinJoinedTeamCap({ userId: session.userId, max: MAX_TEAMS_JOINED_PER_USER, nowSec }),
    );
    const markAccepted = buildInvitationAcceptance(d1, {
      invitationId: invitation.id,
      teamId: invitation.teamId,
      userId: session.userId,
      nowSec,
    });

    const batchResult = await d1.batch([reactivateMembership, markAccepted]);

    if (!didInsert(batchResult?.[0])) {
      const concurrentlyReactivated = await getActiveTeamMembership({
        teamId: invitation.teamId,
        userId: session.userId,
      });

      if (concurrentlyReactivated) {
        throw new ActionError("CONFLICT", {
          key: "Client.Dashboard.Teams.errorAlreadyOnTeam",
        });
      }

      throw new ActionError("FORBIDDEN", {
        key: "Client.Dashboard.Teams.errorJoinLimit",
        params: { max: MAX_TEAMS_JOINED_PER_USER },
      });
    }

    await updateAllSessionsOfUser(session.userId);

    return {
      success: true,
      teamId: invitation.teamId,
      teamSlug: invitation.team.slug,
    };
  }

  const invitationRole = await resolveInvitationRole({
    db,
    teamId: invitation.teamId,
    roleId: invitation.roleId,
    isSystemRole: Boolean(invitation.isSystemRole),
  });

  // Atomic acceptance: one D1 batch (atomic) inserts the membership under the joined-team cap
  // guard and marks the invitation accepted only when that membership now exists. A capped-out
  // insert therefore never leaves an invitation marked accepted without a membership, and vice
  // versa — the guard is authoritative, so no read-then-write pre-check is needed.
  const now = new Date();
  const nowSec = toUnixSeconds(now);
  const invitedAtSec = invitation.createdAt ? toUnixSeconds(new Date(invitation.createdAt)) : nowSec;
  const membershipId = `tmem_${createRandomId()}`;
  const d1 = db.$client;

  const insertMembership = buildMembershipInsert(
    d1,
    {
      id: membershipId,
      teamId: invitation.teamId,
      userId: session.userId,
      roleId: invitationRole.roleId,
      isSystemRole: invitationRole.isSystemRole,
      invitedBy: invitation.invitedBy,
      invitedAtSec,
      joinedAtSec: nowSec,
      nowSec,
    },
    withinJoinedTeamCap({ userId: session.userId, max: MAX_TEAMS_JOINED_PER_USER, nowSec }),
  );

  const markAccepted = buildInvitationAcceptance(d1, {
    invitationId: invitation.id,
    teamId: invitation.teamId,
    userId: session.userId,
    nowSec,
  });

  let batchResult: { meta?: { changes?: number } }[];
  try {
    batchResult = await d1.batch([insertMembership, markAccepted]);
  } catch (error) {
    // (teamId, userId) unique index tripped by a concurrent accept -> already a member.
    if (isUniqueConstraintError(error)) {
      throw new ActionError("CONFLICT", { key: "Client.Dashboard.Teams.errorAlreadyOnTeam" });
    }
    throw error;
  }

  if (!didInsert(batchResult?.[0])) {
    // The conditional insert wrote nothing because the joined-team cap was reached.
    throw new ActionError("FORBIDDEN", {
      key: "Client.Dashboard.Teams.errorJoinLimit",
      params: { max: MAX_TEAMS_JOINED_PER_USER },
    });
  }

  await updateAllSessionsOfUser(session.userId);

  return {
    success: true,
    teamId: invitation.teamId,
    teamSlug: invitation.team.slug,
  };
}

// Email-link acceptance: the raw bearer token from the invitation email is hashed and looked
// up by hash (raw tokens are never stored). Requires a verified-email session.
export async function acceptTeamInvitationByToken(rawToken: string) {
  // requireVerifiedEmail throws without a verified session, so it always returns one here.
  const session = await requireVerifiedEmail();
  const db = getDB();
  const tokenHash = await hashInvitationToken(rawToken);

  const invitation = await db.query.teamInvitationTable.findFirst({
    where: { token: tokenHash },
    with: {
      team: {
        columns: { slug: true },
      },
    },
  });

  if (!invitation) {
    throw new ActionError("NOT_FOUND", { key: "Client.Dashboard.Teams.errorInvitationNotFound" });
  }

  return acceptResolvedInvitation({ invitation, session });
}

// Dashboard acceptance: an authenticated, verified user accepts a pending invitation by its ID.
// The core verifies the invitation's email matches the session's verified email, so no bearer
// token is required or exposed for this path.
export async function acceptTeamInvitationById(invitationId: string) {
  // requireVerifiedEmail throws without a verified session, so it always returns one here.
  const session = await requireVerifiedEmail();

  // Reject a missing session email explicitly, then scope the lookup to it. An invitation for a
  // different email is then indistinguishable from a nonexistent one, so an authenticated user
  // can't probe invitation ids to learn whether one exists for another address.
  const email = requireNormalizedSessionEmail(session);

  const db = getDB();

  const invitation = await db.query.teamInvitationTable.findFirst({
    where: { id: invitationId, email },
    with: {
      team: {
        columns: { slug: true },
      },
    },
  });

  if (!invitation) {
    throw new ActionError("NOT_FOUND", { key: "Client.Dashboard.Teams.errorInvitationNotFound" });
  }

  return acceptResolvedInvitation({ invitation, session });
}
