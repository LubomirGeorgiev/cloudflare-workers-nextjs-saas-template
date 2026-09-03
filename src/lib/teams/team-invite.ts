import "server-only";
import { getDB } from "@/db";
import { TEAM_PERMISSIONS, teamInvitationTable } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { eq } from "drizzle-orm";
import { requireTeamPermission } from "@/utils/team-auth";
import { TEAM_INVITATION_EXPIRY_DAYS } from "@/constants";
import { sendTeamInvitationEmail } from "@/utils/email";
import { getTranslator } from "@/i18n/translator";
import { getUserLocale } from "@/i18n/locale";
import { getTeamEntitlements } from "@/utils/entitlements";
import { fromStoredAddonQuantities } from "@/constants/addons";
import {
  generateInvitationToken,
  hashInvitationToken,
} from "@/lib/teams/invitation-tokens";
import { normalizeEmail } from "@/lib/validation";
import { isEmailBlocked } from "@/lib/auth/blocked-email-guard";
import { createRandomId } from "@/utils/random-token";
import {
  buildInvitationInsert,
  didInsert,
  isUniqueConstraintError,
  toUnixSeconds,
  withinSeatCap,
} from "@/lib/teams/team-writes";
import {
  resolveInvitationRole,
  requirePermissionToAssignRole,
} from "@/lib/teams/team-invitation-roles";

// Uniform, non-revealing success shape. Every invite path returns this so the response never
// discloses whether the email already has an account, is already a member, or was newly
// invited. Membership is only ever created by explicit acceptance.
const INVITE_SUCCESS = { success: true } as const;

export async function inviteUserToTeam({
  teamId,
  email: rawEmail,
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
    throw new ActionError("NOT_AUTHORIZED", { key: "Client.Errors.notAuthenticated" });
  }

  const email = normalizeEmail(rawEmail);

  const db = getDB();
  const invitationRole = await resolveInvitationRole({
    db,
    teamId,
    roleId,
    isSystemRole,
  });

  await requirePermissionToAssignRole({
    session,
    teamId,
    role: invitationRole,
  });

  const team = await db.query.teamTable.findFirst({
    where: { id: teamId },
  });

  if (!team) {
    throw new ActionError("NOT_FOUND", { key: "Client.Dashboard.Teams.errorTeamNotFound" });
  }

  // Seat-cap gate: enforce the team plan's seat limit at this grow point. Counts current
  // members plus outstanding invitations. Limits are enforced only when growing — a team
  // already over a lowered cap keeps its members (never auto-evicted).
  const { limits } = getTeamEntitlements({
    planId: team.subscriptionPlanId,
    subscriptionStatus: team.subscriptionStatus,
    planExpiresAt: team.planExpiresAt,
    addons: fromStoredAddonQuantities(team.subscriptionAddonIds),
  });

  // The invitee may not have an account yet, so there's no preferredLocale to
  // read - use the inviter's locale instead (request-scoped: cookie ->
  // preferredLocale -> Accept-Language -> default).
  const inviterLocale = await getUserLocale();

  // Email content (not an error): translated here, in the inviter's locale. Must be the
  // request-free translator — this service also runs on the API/MCP path, where next-intl's
  // server API resolves to its client build and throws.
  const t = await getTranslator({ locale: inviterLocale, namespace: "Client.Dashboard.Teams" });
  const teamName = team.name as string || t("teamFallbackName");

  const inviter = {
    firstName: session.user.firstName || "",
    lastName: session.user.lastName || "",
    fullName: `${session.user.firstName || ""} ${session.user.lastName || ""}`.trim() || session.user.email,
  };

  // A blocked address gets the uniform success shape and nothing else: no row, no token, no
  // email. Refusing out loud here would break the non-revealing contract INVITE_SUCCESS exists
  // for, turning the invite form into a probe for the blocklist.
  if (await isEmailBlocked(email)) {
    return INVITE_SUCCESS;
  }

  // Fresh bearer token per invite. Only the hash is stored; the raw token goes into the email
  // link and is never persisted or returned.
  const rawToken = generateInvitationToken();
  const tokenHash = await hashInvitationToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime());
  expiresAt.setDate(expiresAt.getDate() + TEAM_INVITATION_EXPIRY_DAYS);

  const sendInvitationEmail = () =>
    sendTeamInvitationEmail({
      email,
      invitationToken: rawToken,
      teamName,
      inviterName: inviter.fullName || t("teamOwnerFallback"),
      locale: inviterLocale,
    });

  // At most one PENDING invitation row per (team, email) — enforced by the partial unique index
  // (WHERE acceptedAt IS NULL). Scope the lookup to pending rows too: accepted history must never
  // shadow a new invite, otherwise a member removed after accepting could never be re-invited.
  const existingInvitation = await db.query.teamInvitationTable.findFirst({
    where: { teamId, email, acceptedAt: { isNull: true } },
  });

  if (existingInvitation) {
    const isPending = existingInvitation.expiresAt
      && new Date(existingInvitation.expiresAt) > now;

    if (isPending) {
      // Resend: this invitation already occupies a seat, so no capacity check is needed.
      await db.update(teamInvitationTable)
        .set({
          roleId: invitationRole.roleId,
          isSystemRole: invitationRole.isSystemRole ? 1 : 0,
          token: tokenHash,
          expiresAt,
          invitedBy: session.userId,
          updatedAt: now,
        })
        .where(eq(teamInvitationTable.id, existingInvitation.id));

      await sendInvitationEmail();
      return INVITE_SUCCESS;
    }

    // Expired (acceptedAt IS NULL, past expiry): it no longer consumes a seat, so delete it
    // and re-invite through the atomic capacity-checked insert below.
    await db.delete(teamInvitationTable)
      .where(eq(teamInvitationTable.id, existingInvitation.id));
  }

  // Atomic seat-cap enforcement: the conditional insert recomputes seat usage (members +
  // non-expired pending invites) inside the statement, so it cannot be raced past the cap the
  // way a read-then-insert can. No separate pre-check is needed.
  const invitationId = `tinv_${createRandomId()}`;
  const nowSec = toUnixSeconds(now);
  const expSec = toUnixSeconds(expiresAt);
  const d1 = db.$client;

  let insertResult: { meta?: { changes?: number } };
  try {
    insertResult = await buildInvitationInsert(
      d1,
      {
        id: invitationId,
        teamId,
        email,
        roleId: invitationRole.roleId,
        isSystemRole: invitationRole.isSystemRole,
        tokenHash,
        invitedBy: session.userId,
        expiresAtSec: expSec,
        nowSec,
      },
      withinSeatCap({ teamId, seats: limits.seats, nowSec }),
    ).run();
  } catch (error) {
    // A concurrent invite created the (teamId, email) row between our lookup and insert. The
    // recipient already has a pending invitation, but it carries the *other* request's token, so
    // this request's email is intentionally not sent (only one live token per pending invite).
    // Accepted minor race: the recipient still receives the concurrent invite's email.
    if (isUniqueConstraintError(error)) {
      return INVITE_SUCCESS;
    }
    throw error;
  }

  if (!didInsert(insertResult)) {
    throw new ActionError("FORBIDDEN", {
      key: "Client.Dashboard.Teams.seatLimitReached",
      params: { seats: limits.seats },
    });
  }

  await sendInvitationEmail();

  return INVITE_SUCCESS;
}
