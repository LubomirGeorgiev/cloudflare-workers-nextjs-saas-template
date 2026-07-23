import "server-only";

import { and, eq, isNull, lt, or } from "drizzle-orm";

import { getDB } from "@/db";
import { teamTrialReservationTable, type TeamTrialReservation } from "@/db/schema";
import { isUniqueConstraintError } from "@/lib/teams/team-writes";

// Re-exported so existing importers keep a single entry point; the classification itself
// lives in a server-only-free module so it can be unit-tested in Node.
export { isDefiniteStripeFailure } from "@/lib/teams/trial-reservation-classification";

interface TrialReservationOwner {
  teamId: string;
  userId: string;
}

interface TrialAttemptParams extends TrialReservationOwner {
  setupIntentId: string;
  planId: string;
  interval: string;
  customerId: string;
  paymentMethodId: string;
  priceId: string;
  trialDays: number;
}

interface TrialAttempt extends TrialAttemptParams {
  id: string;
  isResume: boolean;
}

async function findTrialAttempt({ teamId, userId }: TrialReservationOwner) {
  const [attempt] = await getDB()
    .select()
    .from(teamTrialReservationTable)
    .where(or(
      eq(teamTrialReservationTable.userId, userId),
      eq(teamTrialReservationTable.teamId, teamId),
    ))
    .limit(1);
  return attempt;
}

function matchesTrialAttempt({
  attempt,
  params,
}: {
  attempt: NonNullable<Awaited<ReturnType<typeof findTrialAttempt>>>;
  params: TrialAttemptParams;
}): boolean {
  return attempt.userId === params.userId &&
    attempt.teamId === params.teamId &&
    attempt.setupIntentId === params.setupIntentId &&
    attempt.planId === params.planId &&
    attempt.interval === params.interval;
}

// Atomic trial gate and retry lifecycle. A new attempt inserts one row guarded by unique
// indexes on BOTH userId and teamId. A retry may reuse that row only when every immutable
// Stripe input matches; this lets an ambiguous Stripe request replay the same idempotency
// key without letting a stale or different checkout inherit it.
//
// The attempt id comes from a single-statement INSERT ... RETURNING, preserving the atomic
// gate and providing the stable Stripe key (`team-trial:<id>`). A definite failure releases
// the row, so a later attempt gets a fresh key; an ambiguous failure retains it for replay.
export async function acquireTrialAttempt(params: TrialAttemptParams): Promise<TrialAttempt | null> {
  const db = getDB();

  const [existingAttempt, team, user] = await Promise.all([
    findTrialAttempt(params),
    db.query.teamTable.findFirst({ where: { id: params.teamId } }),
    db.query.userTable.findFirst({ where: { id: params.userId } }),
  ]);

  // This folds the friendly eligibility check into acquisition so a retained exact
  // attempt can resume, while legacy trial stamps still block creating a fresh row.
  if (!team || !user || team.trialUsedAt || user.trialUsedAt) return null;

  if (existingAttempt) {
    if (!matchesTrialAttempt({ attempt: existingAttempt, params })) return null;
    return { ...existingAttempt, isResume: true };
  }

  try {
    const [reservation] = await db
      .insert(teamTrialReservationTable)
      .values(params)
      .returning({ id: teamTrialReservationTable.id });
    return reservation ? { ...params, id: reservation.id, isResume: false } : null;
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    // Same-attempt callers can race between the read and insert. The unique index elects
    // one persisted row; every identical caller resumes it and reaches Stripe with the
    // same parameters and key. A different user's/team's attempt remains blocked.
    const winningAttempt = await findTrialAttempt(params);
    if (!winningAttempt || !matchesTrialAttempt({ attempt: winningAttempt, params })) return null;
    return { ...winningAttempt, isResume: true };
  }
}

// Recovery path: removes the reservation this request just inserted so the user can
// retry after a definite Stripe failure. Scoped to (userId, teamId) so it can only clear
// our own row, never a reservation another request holds.
export async function releaseTrialReservation({ teamId, userId }: TrialReservationOwner): Promise<void> {
  const db = getDB();

  await db
    .delete(teamTrialReservationTable)
    .where(and(
      eq(teamTrialReservationTable.userId, userId),
      eq(teamTrialReservationTable.teamId, teamId),
    ));
}

// Records the subscription Stripe created for this reservation so a crash after creation is
// recoverable by retrieving the real subscription rather than blindly re-creating one.
export async function recordReservationSubscription({
  teamId,
  userId,
  stripeSubscriptionId,
}: TrialReservationOwner & { stripeSubscriptionId: string }): Promise<void> {
  await getDB()
    .update(teamTrialReservationTable)
    .set({ stripeSubscriptionId })
    .where(and(
      eq(teamTrialReservationTable.userId, userId),
      eq(teamTrialReservationTable.teamId, teamId),
    ));
}

// Records a subscription the race-loser could not confirm canceled, so the recovery sweep
// can cancel it later instead of leaving a silent orphan on Stripe.
export async function recordOrphanedSubscription({
  teamId,
  userId,
  orphanedSubscriptionId,
}: TrialReservationOwner & { orphanedSubscriptionId: string }): Promise<void> {
  await getDB()
    .update(teamTrialReservationTable)
    .set({ orphanedSubscriptionId })
    .where(and(
      eq(teamTrialReservationTable.userId, userId),
      eq(teamTrialReservationTable.teamId, teamId),
    ));
}

// Stamps a recovery attempt so the sweep throttles repeated Stripe calls against a
// still-ambiguous reservation and leaves a diagnostic breadcrumb.
export async function markReservationRecoveryAttempt({
  id,
  lastError,
  now = new Date(),
}: {
  id: string;
  lastError?: string;
  now?: Date;
}): Promise<void> {
  await getDB()
    .update(teamTrialReservationTable)
    .set({ lastRecoveryAt: now, ...(lastError ? { lastError } : {}) })
    .where(eq(teamTrialReservationTable.id, id));
}

// Stale reservations for the recovery sweep: created before `createdBefore` (old enough to
// be a genuine crash/abandonment, not an in-flight attempt) and not recovered since
// `recoveredBefore` (so repeatedly-ambiguous rows are not re-driven every cron tick).
export async function findStaleTrialReservations({
  createdBefore,
  recoveredBefore,
  limit,
}: {
  createdBefore: Date;
  recoveredBefore: Date;
  limit: number;
}): Promise<TeamTrialReservation[]> {
  return getDB()
    .select()
    .from(teamTrialReservationTable)
    .where(and(
      lt(teamTrialReservationTable.createdAt, createdBefore),
      or(
        isNull(teamTrialReservationTable.lastRecoveryAt),
        lt(teamTrialReservationTable.lastRecoveryAt, recoveredBefore),
      ),
    ))
    .limit(limit);
}
