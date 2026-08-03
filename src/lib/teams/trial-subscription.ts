import "server-only";

import type Stripe from "stripe";

import { ActionError } from "@/lib/action-error";
import { getStripe } from "@/lib/stripe";
import { getDB } from "@/db";
import { getPlanPriceId } from "@/utils/plan-prices";
import type { BillingInterval, TeamPlanId } from "@/constants/plans";
import { getStripeSubscriptionTransitionPolicy } from "@/constants/subscription-lifecycle";
import {
  claimTeamSubscription,
  ensureStripeCustomer,
  markUserTrialUsed,
  reconcileTeamFromSubscription,
  settleRecordedSubscription,
} from "@/utils/team-subscription";
import {
  acquireTrialAttempt,
  findStaleTrialReservations,
  isDefiniteStripeFailure,
  markReservationRecoveryAttempt,
  recordOrphanedSubscription,
  recordReservationSubscription,
  releaseTrialReservation,
} from "@/lib/teams/trial-reservation";
import type { TeamTrialReservation } from "@/db/schema";

// Only reservations this old are swept: young enough rows may still belong to an in-flight
// completeTrial request that has not finished stamping/releasing yet.
const STALE_RESERVATION_AGE_MS = 30 * 60 * 1000;
// Do not re-drive Stripe for a still-ambiguous reservation more often than this.
const RECOVERY_RETRY_INTERVAL_MS = 30 * 60 * 1000;
const RECOVERY_SWEEP_LIMIT = 20;

interface CompleteTrialSubscriptionParams {
  teamId: string;
  userId: string;
  actingUserEmail: string | null;
  planId: TeamPlanId;
  interval: BillingInterval;
  setupIntentId: string;
  trialDays: number;
}

// The immutable Stripe inputs needed to (re)create a trial subscription with a reservation's
// stable idempotency key. Satisfied by both a fresh TrialAttempt and a persisted reservation.
interface TrialSubscriptionInputs {
  id: string;
  teamId: string;
  customerId: string;
  priceId: string;
  paymentMethodId: string;
  trialDays: number;
}

// The subset of the Stripe client the trial-subscription flow drives directly. Narrowed so
// the recovery sweep can be exercised with a fake client against real D1 (see handleStripeEvent).
export interface TrialSubscriptionStripe {
  subscriptions: {
    create: (
      params: Stripe.SubscriptionCreateParams,
      options: Stripe.RequestOptions,
    ) => Promise<Stripe.Subscription>;
    retrieve: (id: string) => Promise<Stripe.Subscription>;
    cancel: (id: string) => Promise<Stripe.Subscription>;
  };
}

function resolveStripe(stripe?: TrialSubscriptionStripe): TrialSubscriptionStripe {
  return stripe ?? (getStripe() as unknown as TrialSubscriptionStripe);
}

// Reservation-derived key so retries of THIS reservation converge on whatever Stripe did:
// an ambiguous retry returns the subscription Stripe already created (or proves none exists),
// and a definite failure releases the reservation, so a fresh attempt gets a fresh id → key.
function createTrialSubscription(
  stripe: TrialSubscriptionStripe,
  inputs: TrialSubscriptionInputs,
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.create({
    customer: inputs.customerId,
    items: [{ price: inputs.priceId }],
    trial_period_days: inputs.trialDays,
    // The card is attached; if it is ever detached before trial end, cancel instead of
    // generating invoices that can only fail.
    trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    default_payment_method: inputs.paymentMethodId,
    payment_settings: { save_default_payment_method: "on_subscription" },
    metadata: { teamId: inputs.teamId },
  }, {
    idempotencyKey: `team-trial:${inputs.id}`,
  });
}

function stripeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

// Card-first trial flow, step 2 (service): the full attempt lifecycle behind
// completeTrialAction. Transitions: pending (reservation acquired) → created (subscription
// exists) → finalized (team+user stamped, reservation released) / definitely-failed
// (reservation released, error rethrown) / ambiguous (reservation retained for recovery).
export async function completeTrialSubscription(params: CompleteTrialSubscriptionParams): Promise<void> {
  const { teamId, userId, actingUserEmail, planId, interval, setupIntentId, trialDays } = params;
  const stripe = getStripe();
  const db = getDB();

  const team = await db.query.teamTable.findFirst({ where: { id: teamId } });
  if (team?.stripeSubscriptionId) {
    await settleRecordedSubscription({ teamId, recordedSubscriptionId: team.stripeSubscriptionId });
  }

  const customerId = await ensureStripeCustomer({ teamId, actingUserEmail });

  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
  const setupCustomerId = typeof setupIntent.customer === "string"
    ? setupIntent.customer
    : setupIntent.customer?.id;
  const paymentMethodId = typeof setupIntent.payment_method === "string"
    ? setupIntent.payment_method
    : setupIntent.payment_method?.id;

  // The SetupIntent id arrives from the client: only one that succeeded for THIS team's
  // customer may start the trial.
  if (setupCustomerId !== customerId || setupIntent.status !== "succeeded" || !paymentMethodId) {
    throw new ActionError("PRECONDITION_FAILED", { key: "Client.Dashboard.Billing.errorTrialUnavailable" });
  }

  // ...and only for the exact team/plan/interval it was stamped with in startTrialSetupAction,
  // so a stale dialog cannot start a mismatched subscription.
  const setupMetadata = setupIntent.metadata ?? {};
  if (
    setupMetadata.teamId !== teamId ||
    setupMetadata.planId !== planId ||
    setupMetadata.interval !== interval
  ) {
    throw new ActionError("PRECONDITION_FAILED", { key: "Client.Dashboard.Billing.errorTrialUnavailable" });
  }

  // Acquire a fresh atomic reservation or resume the exact persisted attempt. Bound inputs
  // keep the idempotency key safe to reuse after an ambiguous response; a different checkout
  // stays blocked by the user/team unique indexes.
  const trialAttempt = await acquireTrialAttempt({
    teamId,
    userId,
    setupIntentId,
    planId,
    interval,
    customerId,
    paymentMethodId,
    priceId: getPlanPriceId({ planId, interval }),
    trialDays,
  });
  if (!trialAttempt) {
    throw new ActionError("PRECONDITION_FAILED", { key: "Client.Dashboard.Billing.errorTrialUnavailable" });
  }

  let subscription: Stripe.Subscription;
  try {
    subscription = await createTrialSubscription(stripe as unknown as TrialSubscriptionStripe, trialAttempt);
  } catch (stripeError) {
    // Release ONLY when Stripe definitely created nothing (a rejected request), so the user
    // can retry. On an ambiguous failure keep the reservation — a second trial must stay
    // blocked — and stamp the attempt so the recovery sweep can later settle it against
    // Stripe using the same reservation-derived idempotency key.
    if (isDefiniteStripeFailure(stripeError)) {
      await releaseTrialReservation({ teamId, userId });
    } else {
      await markReservationRecoveryAttempt({ id: trialAttempt.id, lastError: stripeErrorName(stripeError) });
    }
    throw stripeError;
  }

  // Persist the created subscription id before claiming/reconciling so a crash in the
  // remaining steps is recoverable by retrieval rather than a blind re-create.
  await recordReservationSubscription({ teamId, userId, stripeSubscriptionId: subscription.id });

  const claimedSlot = await claimTeamSubscription({ teamId, subscriptionId: subscription.id });
  if (!claimedSlot) {
    await discardLosingTrial({ stripe: stripe as unknown as TrialSubscriptionStripe, teamId, userId, subscription });
    throw new ActionError("CONFLICT", { key: "Client.Dashboard.Billing.errorStartCheckout" });
  }

  // Reconciling the trialing snapshot stamps the team; stamp the acting user too, then
  // release the reservation — its user+team gate is now enforced by the trialUsedAt stamps.
  await reconcileTeamFromSubscription({ subscription });
  await markUserTrialUsed(userId);
  await releaseTrialReservation({ teamId, userId });
}

// Lost a concurrent subscribe race: discard our trial and let the winner stand. Keep the
// reservation unless Stripe confirms cancellation (an ambiguous failure may leave a live
// trial behind); record the uncanceled subscription so the recovery sweep can clean it up.
async function discardLosingTrial({
  stripe,
  teamId,
  userId,
  subscription,
}: {
  stripe: TrialSubscriptionStripe;
  teamId: string;
  userId: string;
  subscription: Stripe.Subscription;
}): Promise<void> {
  const cancellation = await stripe.subscriptions.cancel(subscription.id);
  await reconcileTeamFromSubscription({ subscription: cancellation });

  if (cancellation.status !== "canceled") {
    await recordOrphanedSubscription({ teamId, userId, orphanedSubscriptionId: subscription.id });
    throw new Error(`Stripe did not confirm cancellation for trial ${subscription.id}`);
  }

  await releaseTrialReservation({ teamId, userId });
}

// Recovery sweep for reservations left behind by a crash or ambiguous Stripe failure.
// Settles each against Stripe FIRST (never a bare TTL delete, which would reopen user-level
// trial farming), then finalizes or releases. Returns the number settled.
export async function settleStaleTrialReservations({
  now = new Date(),
  limit = RECOVERY_SWEEP_LIMIT,
  stripe,
}: {
  now?: Date;
  limit?: number;
  // Injectable for tests; defaults to the shared Stripe client.
  stripe?: TrialSubscriptionStripe;
} = {}): Promise<number> {
  const client = resolveStripe(stripe);
  const stale = await findStaleTrialReservations({
    createdBefore: new Date(now.getTime() - STALE_RESERVATION_AGE_MS),
    recoveredBefore: new Date(now.getTime() - RECOVERY_RETRY_INTERVAL_MS),
    limit,
  });

  let settledCount = 0;
  for (const reservation of stale) {
    try {
      await settleReservation({ stripe: client, reservation });
      settledCount += 1;
    } catch (error) {
      console.error("settleStaleTrialReservations: reservation settle failed", {
        reservationId: reservation.id,
        error,
      });
      // Retain, but stamp the attempt so an ambiguous row is not re-driven next tick.
      await markReservationRecoveryAttempt({
        id: reservation.id,
        lastError: stripeErrorName(error),
        now,
      }).catch(() => {});
    }
  }

  return settledCount;
}

async function retrieveSubscriptionOrNull(
  stripe: TrialSubscriptionStripe,
  subscriptionId: string,
): Promise<Stripe.Subscription | null> {
  return stripe.subscriptions
    .retrieve(subscriptionId)
    .catch((error: unknown) => {
      if ((error as { code?: string })?.code === "resource_missing") {
        return null;
      }
      throw error;
    });
}

async function cancelOrphanIfPresent(
  stripe: TrialSubscriptionStripe,
  subscriptionId: string,
): Promise<void> {
  await stripe.subscriptions
    .cancel(subscriptionId)
    .catch((error: unknown) => {
      // Already gone or auto-expired — nothing to clean up.
      if ((error as { code?: string })?.code === "resource_missing") {
        return;
      }
      console.error("settleStaleTrialReservations: orphan cancel failed", { subscriptionId, error });
    });
}

async function settleReservation({
  stripe,
  reservation,
}: {
  stripe: TrialSubscriptionStripe;
  reservation: TeamTrialReservation;
}): Promise<void> {
  const owner = { teamId: reservation.teamId, userId: reservation.userId };

  // Clean up a known race-loser orphan first (best-effort).
  if (reservation.orphanedSubscriptionId) {
    await cancelOrphanIfPresent(stripe, reservation.orphanedSubscriptionId);
  }

  // Case 1: a subscription id was recorded — settle against the real subscription.
  if (reservation.stripeSubscriptionId) {
    const subscription = await retrieveSubscriptionOrNull(stripe, reservation.stripeSubscriptionId);
    if (!subscription) {
      // Stripe has no such subscription (never persisted / deleted): safe to release.
      await releaseTrialReservation(owner);
      return;
    }
    await finalizeOrRelease({ owner, subscription });
    return;
  }

  // Case 2: no recorded subscription — re-drive creation with the SAME idempotency key. This
  // returns the subscription Stripe already created (ambiguous failure) or creates it now
  // (crash before creation). Either way we observe the real outcome.
  let subscription: Stripe.Subscription;
  try {
    subscription = await createTrialSubscription(stripe, {
      id: reservation.id,
      teamId: reservation.teamId,
      customerId: reservation.customerId,
      priceId: reservation.priceId,
      paymentMethodId: reservation.paymentMethodId,
      trialDays: reservation.trialDays,
    });
  } catch (error) {
    if (isDefiniteStripeFailure(error)) {
      // Stripe rejected outright — nothing was created — so release for a fresh attempt.
      await releaseTrialReservation(owner);
      return;
    }
    // Still ambiguous: rethrow so the caller stamps the attempt and retries next sweep.
    throw error;
  }

  await recordReservationSubscription({ ...owner, stripeSubscriptionId: subscription.id });
  await finalizeOrRelease({ owner, subscription });
}

// Stamp the user (the team is stamped by reconcile) and release only when the subscription
// actually consumed the trial; otherwise release without stamping so the user may retry.
async function finalizeOrRelease({
  owner,
  subscription,
}: {
  owner: { teamId: string; userId: string };
  subscription: Stripe.Subscription;
}): Promise<void> {
  await reconcileTeamFromSubscription({ subscription });

  const policy = getStripeSubscriptionTransitionPolicy(subscription.status);
  const consumedTrial = subscription.status === "trialing" || Boolean(policy?.grantsPaidAccess);

  if (consumedTrial) {
    await markUserTrialUsed(owner.userId);
  }
  await releaseTrialReservation(owner);
}
