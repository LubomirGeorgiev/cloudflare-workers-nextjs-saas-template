import "server-only";

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { ROLES_ENUM } from "@/app/enums";
import { USER_BAN_EVENT_PAGE_SIZE } from "@/constants";
import { getDB } from "@/db";
import {
  apiKeyTable,
  SYSTEM_ROLES_ENUM,
  teamInvitationTable,
  userBanEventTable,
  userTable,
  type UserBanEventAction,
} from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { isBanned } from "@/lib/account/ban";
import {
  cancelTeamSubscriptionAsAdmin,
  getTeamBillingRisk,
  type TeamBillingRisk,
} from "@/lib/admin/team-billing-admin";
import { enqueueBillingCancelSubscription } from "@/lib/scheduler/enqueue";
import type { BanUserSchema, UnbanUserSchema } from "@/schemas/admin-users.schema";
import { sendBanNoticeEmail, sendUnbanNoticeEmail } from "@/utils/email";
import { deleteAllSessionsOfUser, updateAllSessionsOfUser } from "@/utils/kv-session";
import { purgeUserPrincipalCaches } from "@/utils/kv-principal-purge";
import { mapInBatches } from "@/utils/map-in-batches";

// Banning and unbanning one account. A ban keeps the row and takes away every way to
// authenticate: cookie sessions, API keys, and OAuth grants. It is not a deletion and it is not
// an erasure — see `docs/` and the decisions listed in this file's comments.
//
// Deliberately *not* self-authenticating, exactly like `./users.ts`: the panel authorizes with a
// cookie session (`requireAdmin`) and the internal API with a bearer credential
// (`assertAdminPrincipal`). Never mount one of these on a route without a guard ahead of it.

/** Same bound-parameter ceiling `admin-api-keys.ts` chunks against: SQLite allows 100 per statement. */
const REVOKE_ID_CHUNK_SIZE = 50;

/** Grant revocation is a KV write per grant; keep the fan-out inside the subrequest budget. */
const GRANT_REVOKE_BATCH_SIZE = 5;

/** Cancelling is a Stripe round trip per team, so owned teams are cancelled a few at a time. */
const TEAM_CANCEL_BATCH_SIZE = 3;

/** What the notice greets them as. Falls back rather than greeting nobody. */
function displayNameFor(user: { firstName: string | null; email: string | null }): string {
  return user.firstName || user.email || "there";
}

function logBanCleanupFailure(step: string) {
  return (error: unknown) => {
    console.error(`Ban cleanup failed: ${step}`, error);
  };
}

// Imported inside the function, never at module scope. The grant module reaches the OAuth
// provider, which pulls `cloudflare:workers` in through a node_modules dependency the build-time
// OpenAPI generator cannot resolve outside workerd — and this file is on that generator's graph.
// `src/lib/admin/users.ts` carries the same note for the same reason.
async function loadConnectedApps() {
  return import("@/lib/oauth/connected-apps");
}

interface BanTargetTeam {
  teamId: string;
  teamName: string;
  teamSlug: string;
}

interface UserBanImpact {
  userId: string;
  email: string | null;
  /** Banning an admin is refused; the card shows why rather than offering a button that fails. */
  isAdmin: boolean;
  isBanned: boolean;
  activeApiKeyCount: number;
  connectedAppCount: number;
  pendingInvitationCount: number;
  /** Teams whose subscription the ban cancels, with the billing consequences spelled out. */
  ownedTeams: TeamBillingRisk[];
  /** Teams the user only belongs to. Listed so staff can see the ban reached no further. */
  memberOnlyTeams: BanTargetTeam[];
}

/** The `owner` system role is the only thing that makes a team "theirs" for billing purposes. */
function isOwnerMembership(membership: { roleId: string; isSystemRole: number }): boolean {
  return Boolean(membership.isSystemRole) && membership.roleId === SYSTEM_ROLES_ENUM.OWNER;
}

async function readOwnedAndMemberTeams(userId: string) {
  const memberships = await getDB().query.teamMembershipTable.findMany({
    where: { userId },
    columns: { teamId: true, roleId: true, isSystemRole: true },
    with: { team: { columns: { name: true, slug: true } } },
  });

  return {
    ownedTeamIds: memberships.filter(isOwnerMembership).map((membership) => membership.teamId),
    memberOnlyTeams: memberships
      .filter((membership) => !isOwnerMembership(membership))
      .map((membership) => ({
        teamId: membership.teamId,
        teamName: membership.team.name,
        teamSlug: membership.team.slug,
      })),
  };
}

/**
 * Everything the ban form must state before staff confirm. Reads D1, KV, and Stripe, so callers
 * put it behind its own Suspense boundary.
 */
export async function getUserBanImpact({ userId }: { userId: string }): Promise<UserBanImpact> {
  const db = getDB();

  const user = await db.query.userTable.findFirst({
    where: { id: userId },
    columns: { id: true, email: true, role: true, bannedAt: true },
  });

  if (!user) {
    throw new ActionError("NOT_FOUND", "User not found");
  }

  const { listConnectedAppsForUser } = await loadConnectedApps();

  // Independent reads over four stores; none of them guards another.
  const [apiKeys, connectedApps, invitations, teams] = await Promise.all([
    db.query.apiKeyTable.findMany({
      where: { userId, revokedAt: { isNull: true } },
      columns: { id: true },
    }),
    listConnectedAppsForUser({ userId }),
    db.query.teamInvitationTable.findMany({
      where: { invitedBy: userId, acceptedAt: { isNull: true } },
      columns: { id: true },
    }),
    readOwnedAndMemberTeams(userId),
  ]);

  const ownedTeams = await mapInBatches({
    items: teams.ownedTeamIds,
    batchSize: TEAM_CANCEL_BATCH_SIZE,
    fn: (teamId) => getTeamBillingRisk({ teamId }),
  });

  return {
    userId: user.id,
    email: user.email,
    isAdmin: user.role === ROLES_ENUM.ADMIN,
    isBanned: isBanned(user),
    activeApiKeyCount: apiKeys.length,
    connectedAppCount: connectedApps.length,
    pendingInvitationCount: invitations.length,
    ownedTeams,
    memberOnlyTeams: teams.memberOnlyTeams,
  };
}

export interface UserBanEvent {
  id: string;
  action: UserBanEventAction;
  internalReason: string;
  externalReason: string | null;
  actorUserId: string | null;
  /** The actor's name (or email) at read time; null when the actor row is gone or has neither. */
  actorName: string | null;
  noticeQueuedAt: Date | null;
  cancelledSubscriptionCount: number | null;
  createdAt: Date;
}

/** Staff-facing label for an actor row. Null lets the caller fall back to the raw id. */
function toActorName({
  firstName,
  lastName,
  email,
}: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}): string | null {
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  return fullName || email || null;
}

/**
 * Actor ids -> display names, resolved at read time rather than stored: the event keeps the id
 * as a record, and the name follows whatever the admin's profile says today.
 */
async function resolveActorNames(actorUserIds: string[]): Promise<Map<string, string | null>> {
  // At most USER_BAN_EVENT_PAGE_SIZE distinct ids, well inside SQLite's bound-parameter ceiling.
  const ids = [...new Set(actorUserIds)];
  if (ids.length === 0) {
    return new Map();
  }

  const actors = await getDB().query.userTable.findMany({
    where: { id: { in: ids } },
    columns: { id: true, firstName: true, lastName: true, email: true },
  });

  return new Map(actors.map((actor) => [actor.id, toActorName(actor)]));
}

/**
 * One user's ban history, newest first and always bounded. For a repeat offender this list is the
 * thing staff actually need, and it is why the events are stored rather than the state alone.
 */
export async function listUserBanEvents({
  userId,
  limit = USER_BAN_EVENT_PAGE_SIZE,
}: {
  userId: string;
  limit?: number;
}): Promise<UserBanEvent[]> {
  const events = await getDB().query.userBanEventTable.findMany({
    where: { userId },
    columns: {
      id: true,
      action: true,
      internalReason: true,
      externalReason: true,
      actorUserId: true,
      noticeQueuedAt: true,
      cancelledSubscriptionCount: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    limit: Math.min(limit, USER_BAN_EVENT_PAGE_SIZE),
  });

  const actorNames = await resolveActorNames(
    events.flatMap((event) => (event.actorUserId ? [event.actorUserId] : [])),
  );

  return events.map((event) => ({
    ...event,
    actorName: event.actorUserId ? (actorNames.get(event.actorUserId) ?? null) : null,
  }));
}

/**
 * Why no notice was sent, so the card says "no email address on file" rather than implying one
 * went out. `queue-failed` is its own outcome because the queue write rejected: no notice exists,
 * and recording that as "queued" would claim a delivery nothing will ever make.
 */
type BanNoticeOutcome = "queued" | "queue-failed" | "not-requested" | "no-email-address";

/** What one enforcement pass actually did. Repeated on every ban call, so the counts can differ. */
interface BanCleanupCounts {
  revokedApiKeyCount: number;
  revokedGrantCount: number;
  revokedInvitationCount: number;
  cancelledSubscriptionCount: number;
  /** Teams whose subscription neither Stripe nor the retry queue accepted. Staff cancel by hand. */
  subscriptionCancellationFailedCount: number;
}

export interface BanUserResult extends BanCleanupCounts {
  userId: string;
  /** The address the notice went to, or would have; the caller's blocklist follow-up reuses it. */
  email: string | null;
  bannedAt: Date;
  /** True when the account was already banned: no second event row and no second notice. */
  alreadyBanned: boolean;
  noticeOutcome: BanNoticeOutcome;
}

// Revokes every live key of the user, not only the internal ones: a ban takes all of them.
//
// The KV snapshots are NOT deleted here. Step 7 of the ban calls `purgeUserPrincipalCaches`,
// which enumerates this user's key hashes from D1 and deletes every snapshot — doing it here as
// well would be a second KV fan-out over exactly the same keys. Keep that order, or the snapshots
// outlive the revocation until the cache TTL lapses.
async function revokeAllApiKeysForUser(userId: string): Promise<number> {
  const db = getDB();

  const keys = await db.query.apiKeyTable.findMany({
    where: { userId, revokedAt: { isNull: true } },
    columns: { id: true },
  });

  if (keys.length === 0) {
    return 0;
  }

  // One timestamp for the whole ban, so chunking cannot make one act look like several events.
  // Every chunk is attempted even after one throws; a chunk left live is a credential nobody can
  // reach, and the first failure is rethrown once the rest are done.
  const revokedAt = new Date();
  const ids = keys.map((key) => key.id);
  let failure: unknown;

  for (let start = 0; start < ids.length; start += REVOKE_ID_CHUNK_SIZE) {
    const chunk = ids.slice(start, start + REVOKE_ID_CHUNK_SIZE);

    try {
      await db.update(apiKeyTable).set({ revokedAt }).where(inArray(apiKeyTable.id, chunk));
    } catch (error) {
      failure ??= error;
    }
  }

  if (failure !== undefined) {
    throw new Error("API key chunk revocation failed during ban", { cause: failure });
  }

  return ids.length;
}

async function revokeAllGrantsForUser(userId: string): Promise<number> {
  const { listConnectedAppsForUser, revokeConnectedAppForUser } = await loadConnectedApps();
  const grants = await listConnectedAppsForUser({ userId });

  await mapInBatches({
    items: grants,
    batchSize: GRANT_REVOKE_BATCH_SIZE,
    // The provider deletes the grant and every token minted from it; the refresh token dies too.
    fn: (grant) => revokeConnectedAppForUser({ grantId: grant.grantId, userId }),
  });

  return grants.length;
}

// Otherwise a banned user's outstanding invitations keep adding members to their team after the
// ban. Revoked by deletion, matching how an expired invitation is cleared elsewhere.
async function revokeSentInvitations(userId: string): Promise<number> {
  const revoked = await getDB()
    .delete(teamInvitationTable)
    .where(and(
      eq(teamInvitationTable.invitedBy, userId),
      isNull(teamInvitationTable.acceptedAt),
    ))
    .returning({ id: teamInvitationTable.id });

  return revoked.length;
}

/** Per team: cancelled (now or by the queued retry), nothing to cancel, or neither took it. */
type TeamCancellationOutcome = "cancelled" | "nothing-to-cancel" | "failed";

interface TeamCancellationCounts {
  cancelledCount: number;
  failedCount: number;
}

/**
 * Cancel the subscription of every team the user owns, one `.catch` each.
 *
 * A Stripe failure never blocks the ban: it enqueues the retry job instead. One team failing must
 * not stop the others, and must not stop the cache purge that follows.
 *
 * When the retry enqueue rejects too, nothing will ever cancel that subscription, so it is counted
 * as failed rather than cancelled — the caller must not tell the user their billing stopped.
 */
async function cancelOwnedTeamSubscriptions({
  ownedTeamIds,
  reason,
}: {
  ownedTeamIds: string[];
  reason: string;
}): Promise<TeamCancellationCounts> {
  const outcomes = await mapInBatches({
    items: ownedTeamIds,
    batchSize: TEAM_CANCEL_BATCH_SIZE,
    fn: async (teamId): Promise<TeamCancellationOutcome> => {
      const team = await getDB().query.teamTable.findFirst({
        where: { id: teamId },
        columns: { stripeSubscriptionId: true },
      });

      if (!team?.stripeSubscriptionId) {
        return "nothing-to-cancel";
      }

      const subscriptionId = team.stripeSubscriptionId;

      return cancelTeamSubscriptionAsAdmin({ teamId, subscriptionId, reason })
        .then((result): TeamCancellationOutcome => (
          result.cancelled ? "cancelled" : "nothing-to-cancel"
        ))
        .catch(async (error: unknown): Promise<TeamCancellationOutcome> => {
          logBanCleanupFailure(`Stripe cancellation for team ${teamId}`)(error);

          return enqueueBillingCancelSubscription({ teamId, subscriptionId })
            // Counted as cancelled: the retry will land, and the user must be told their
            // subscription is gone rather than left to discover it.
            .then((): TeamCancellationOutcome => "cancelled")
            .catch((enqueueError: unknown): TeamCancellationOutcome => {
              logBanCleanupFailure(
                `cancellation retry enqueue for team ${teamId}; subscription ${subscriptionId} ` +
                  "is still live and needs a manual cancellation",
              )(enqueueError);

              return "failed";
            });
        });
    },
  });

  return {
    cancelledCount: outcomes.filter((outcome) => outcome === "cancelled").length,
    failedCount: outcomes.filter((outcome) => outcome === "failed").length,
  };
}

/**
 * The one write-back to the event row: `noticeQueuedAt` together with `externalReason` IS the
 * record of what was delivered, and only an outcome of `queued` may stamp it.
 */
async function finalizeBanEvent({
  eventId,
  noticeOutcome,
  cancelledSubscriptionCount = 0,
}: {
  eventId: string | undefined;
  noticeOutcome: BanNoticeOutcome;
  cancelledSubscriptionCount?: number;
}): Promise<void> {
  if (!eventId) {
    return;
  }

  const facts: { noticeQueuedAt?: Date; cancelledSubscriptionCount?: number } = {};

  if (noticeOutcome === "queued") {
    facts.noticeQueuedAt = new Date();
  }

  if (cancelledSubscriptionCount > 0) {
    facts.cancelledSubscriptionCount = cancelledSubscriptionCount;
  }

  if (Object.keys(facts).length === 0) {
    return;
  }

  await getDB()
    .update(userBanEventTable)
    .set(facts)
    .where(eq(userBanEventTable.id, eventId))
    .catch(logBanCleanupFailure("ban event finalize"));
}

/**
 * The notice half both actions share: the two "no notice" outcomes, and the rule that a notice is
 * only ever QUEUED. It never blocks, and its failure is logged rather than thrown — the ban or
 * unban has already landed by the time this runs, so a mail problem must not report it as failed.
 *
 * The payload itself is built by the caller. That is deliberate: the two payload shapes differ,
 * and neither has a field for the staff-only internal reason.
 */
async function queueNotice({
  sendEmail,
  email,
  step,
  send,
}: {
  sendEmail: boolean;
  email: string | null;
  /** Named in the log line when the queue write fails. */
  step: string;
  send: (recipient: string) => Promise<void>;
}): Promise<BanNoticeOutcome> {
  if (!sendEmail) {
    return "not-requested";
  }

  if (!email) {
    return "no-email-address";
  }

  // The outcome follows the promise. A rejected queue write means no notice exists, so it must
  // never be reported — or stamped on the event row — as queued.
  return send(email)
    .then((): BanNoticeOutcome => "queued")
    .catch((error: unknown): BanNoticeOutcome => {
      logBanCleanupFailure(step)(error);

      return "queue-failed";
    });
}

/**
 * Steps 2-7 of the ban: everything that takes access away. Idempotent by construction — every step
 * either finds nothing left to do or does it again harmlessly — so it runs on EVERY ban call,
 * including one against an account that is already banned. That repeat pass is the only repair a
 * partly failed ban ever gets, because each step only logs its own failure.
 */
async function enforceBanCleanup({
  userId,
  internalReason,
}: {
  userId: string;
  internalReason: string;
}): Promise<BanCleanupCounts> {
  const { ownedTeamIds } = await readOwnedAndMemberTeams(userId);

  // Steps 2-5. Independent stores, each with its own `.catch` so one failure cannot skip another.
  const [revokedApiKeyCount, revokedGrantCount, revokedInvitationCount, cancellation] =
    await Promise.all([
      revokeAllApiKeysForUser(userId).catch((error: unknown) => {
        logBanCleanupFailure("API keys")(error);
        return 0;
      }),
      revokeAllGrantsForUser(userId).catch((error: unknown) => {
        logBanCleanupFailure("OAuth grants")(error);
        return 0;
      }),
      revokeSentInvitations(userId).catch((error: unknown) => {
        logBanCleanupFailure("sent invitations")(error);
        return 0;
      }),
      cancelOwnedTeamSubscriptions({
        ownedTeamIds,
        // Reaches Stripe as `cancellation_details.comment`, so it joins the billing record.
        reason: `Banned by staff: ${internalReason}`,
      }).catch((error: unknown): TeamCancellationCounts => {
        logBanCleanupFailure("owned team subscriptions")(error);
        return { cancelledCount: 0, failedCount: ownedTeamIds.length };
      }),
    ]);

  // Step 6, then step 7. The purge must follow the revocations above, never precede them.
  await deleteAllSessionsOfUser(userId).catch(logBanCleanupFailure("KV sessions"));
  await purgeUserPrincipalCaches(userId).catch(logBanCleanupFailure("principal caches"));

  return {
    revokedApiKeyCount,
    revokedGrantCount,
    revokedInvitationCount,
    cancelledSubscriptionCount: cancellation.cancelledCount,
    subscriptionCancellationFailedCount: cancellation.failedCount,
  };
}

/**
 * The stamp on a row this call did not flip. Re-read rather than reused from the row loaded
 * earlier, because a concurrent ban may have written it since; the fallback covers a deleted row.
 */
async function readBanStamp({
  userId,
  fallback,
}: {
  userId: string;
  fallback: Date;
}): Promise<Date> {
  const row = await getDB().query.userTable.findFirst({
    where: { id: userId },
    columns: { bannedAt: true },
  });

  return row?.bannedAt ?? fallback;
}

/**
 * Ban one account.
 *
 * The order is the part that is wrong-by-default rather than wrong-by-typo:
 *
 * 1. Write `user.bannedAt`, guarded on it still being null, and append the `ban` event. D1 has no
 *    transactions, so this is durable before anything else runs and no cleanup failure may stop
 *    the steps after it. The guard makes the flip the one thing that decides the transition: a
 *    concurrent second call writes no row, so it writes no second event and sends no second notice.
 * 2-7. `enforceBanCleanup`: revoke keys, revoke grants, revoke sent invitations, cancel owned
 *    subscriptions, delete every KV session, purge the principal caches. See that function for the
 *    order and why it is that order.
 * 8. Queue the notice, last and only ever queued, so it can never fail the ban and can never
 *    announce a ban that did not land.
 *
 * Re-banning an account that is already banned repeats steps 2-7 and nothing else. Every cleanup
 * step only logs its own failure, so the repeat pass is how a half-finished ban gets repaired:
 * a session that survived a KV outage, or keys a D1 failure left live. It writes no second event
 * row and sends no second notice to somebody already told, and reports `alreadyBanned: true` with
 * the counts the repeat pass actually did.
 *
 * Propagation: KV is eventually consistent. Revocation is immediate at the writing point of
 * presence and takes up to about six minutes everywhere else: the 300-second snapshot TTL
 * (`API_KEY_CACHE_TTL_SECONDS`, and `OAUTH_GRANT_CACHE_TTL_SECONDS`, which matches it) plus the
 * ~60 seconds KV needs to propagate a delete to every location.
 */
export async function banUser({
  userId,
  internalReason,
  externalReason,
  sendEmail,
  actorUserId,
}: Omit<BanUserSchema, "alsoBlockEmail"> & { actorUserId: string | null }): Promise<BanUserResult> {
  const db = getDB();

  const user = await db.query.userTable.findFirst({
    where: { id: userId },
    columns: { id: true, email: true, firstName: true, role: true, bannedAt: true },
  });

  if (!user) {
    throw new ActionError("NOT_FOUND", "User not found");
  }

  // One invariant kept simple: a banned account is never an admin account. Staff demote first,
  // through `setUserRole`, which already revokes internal keys and grants.
  if (user.role === ROLES_ENUM.ADMIN) {
    throw new ActionError(
      "PRECONDITION_FAILED",
      "This account is an admin. Change its role to `user` before banning it.",
    );
  }

  if (actorUserId && actorUserId === userId) {
    throw new ActionError("PRECONDITION_FAILED", "You cannot ban your own account.");
  }

  const bannedAt = new Date();

  // Step 1. The authoritative fact, guarded so only one call can flip it. A caller that writes no
  // row — an account already banned, or the loser of two concurrent bans — takes the repeat path:
  // it still enforces, but it appends no event and sends no notice.
  const [flipped] = await db
    .update(userTable)
    .set({ bannedAt })
    .where(and(eq(userTable.id, userId), isNull(userTable.bannedAt)))
    .returning({ id: userTable.id });

  const isFirstTransition = Boolean(flipped);

  // The event row is created here rather than once every fact is known: the record of a ban must
  // exist before the work that can fail, so step 8 and the cancellation count write back to it.
  const [event] = isFirstTransition
    ? await db
      .insert(userBanEventTable)
      .values({
        userId,
        action: "ban",
        internalReason,
        // Never stored as text staff did not choose to send: a silent ban records no external copy.
        externalReason: sendEmail ? externalReason ?? null : null,
        actorUserId,
      })
      .returning({ id: userBanEventTable.id })
    : [];

  // Steps 2-7, on every call. On a repeat this is the retry a failed step never otherwise gets.
  const counts = await enforceBanCleanup({ userId, internalReason });

  // Step 8. Only the call that flipped the row tells the account holder anything.
  const noticeOutcome = isFirstTransition
    ? await queueNotice({
      sendEmail,
      email: user.email,
      step: "ban notice email",
      send: (recipient) => sendBanNoticeEmail({
        email: recipient,
        username: displayNameFor(user),
        externalReason,
        subscriptionCancelled: counts.cancelledSubscriptionCount > 0,
      }),
    })
    : "not-requested";

  await finalizeBanEvent({
    eventId: event?.id,
    noticeOutcome,
    cancelledSubscriptionCount: counts.cancelledSubscriptionCount,
  });

  return {
    userId,
    email: user.email,
    bannedAt: isFirstTransition ? bannedAt : await readBanStamp({ userId, fallback: bannedAt }),
    alreadyBanned: !isFirstTransition,
    ...counts,
    noticeOutcome,
  };
}

export interface UnbanUserResult {
  userId: string;
  /** True when the account was not banned: nothing was written and nothing was sent. */
  wasNotBanned: boolean;
  /** Read from the latest `ban` event, so the notice can tell the truth about billing. */
  cancelledSubscriptionCount: number;
  noticeOutcome: BanNoticeOutcome;
}

/**
 * Lift a ban.
 *
 * Nothing is cleared and nothing is overwritten. The ban event keeps its reason, its actor, and
 * its notice facts forever, so a ban -> unban -> ban cycle keeps every round.
 *
 * Unban restores access. It does not restore anything that was revoked or cancelled: the API keys
 * and OAuth grants stay revoked, the sent invitations stay revoked, and the subscription is gone
 * — the owner subscribes again by hand. That list is what the notice has to carry.
 */
export async function unbanUser({
  userId,
  internalReason,
  externalReason,
  sendEmail,
  actorUserId,
}: UnbanUserSchema & { actorUserId: string | null }): Promise<UnbanUserResult> {
  const db = getDB();

  const user = await db.query.userTable.findFirst({
    where: { id: userId },
    columns: { id: true, email: true, firstName: true, bannedAt: true },
  });

  if (!user) {
    throw new ActionError("NOT_FOUND", "User not found");
  }

  if (!isBanned(user)) {
    return {
      userId,
      wasNotBanned: true,
      cancelledSubscriptionCount: 0,
      noticeOutcome: "not-requested",
    };
  }

  // Read BEFORE anything is written: the unban notice needs it to tell the truth about billing,
  // and it lives on the ban event rather than on the user row.
  const [latestBan] = await db.query.userBanEventTable.findMany({
    where: { userId, action: "ban" },
    columns: { cancelledSubscriptionCount: true },
    orderBy: { createdAt: "desc" },
    limit: 1,
  });
  const cancelledSubscriptionCount = latestBan?.cancelledSubscriptionCount ?? 0;

  // That single write ends the ban, guarded the way the ban's own write is: the call that clears
  // the stamp owns the event and the notice, so a concurrent second unban adds neither.
  const [lifted] = await db
    .update(userTable)
    .set({ bannedAt: null })
    .where(and(eq(userTable.id, userId), isNotNull(userTable.bannedAt)))
    .returning({ id: userTable.id });

  if (!lifted) {
    return {
      userId,
      wasNotBanned: true,
      cancelledSubscriptionCount: 0,
      noticeOutcome: "not-requested",
    };
  }

  const [event] = await db
    .insert(userBanEventTable)
    .values({
      userId,
      action: "unban",
      internalReason,
      externalReason: sendEmail ? externalReason ?? null : null,
      actorUserId,
    })
    .returning({ id: userBanEventTable.id });

  // Rebuild rather than delete: the ban deleted every session, so this only repairs a stale
  // snapshot left by a direct database ban, and drops the bearer caches on the way through.
  await updateAllSessionsOfUser(userId).catch(logBanCleanupFailure("session refresh"));

  const noticeOutcome = await queueNotice({
    sendEmail,
    email: user.email,
    step: "unban notice email",
    send: (recipient) => sendUnbanNoticeEmail({
      email: recipient,
      username: displayNameFor(user),
      externalReason,
      cancelledSubscriptionCount,
    }),
  });

  await finalizeBanEvent({ eventId: event?.id, noticeOutcome });

  return { userId, wasNotBanned: false, cancelledSubscriptionCount, noticeOutcome };
}
