import "server-only";

import { cache } from "react";
import type Stripe from "stripe";

import { NAME_MAX_LENGTH } from "@/constants";
import { SUBSCRIPTION_WITHDRAWAL_METADATA } from "@/constants/eu-withdrawal";
import { getPlan } from "@/constants/plans";
import { getStripeSubscriptionTransitionPolicy } from "@/constants/subscription-lifecycle";
import { getDB } from "@/db";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { ActionError } from "@/lib/action-error";
import {
  isWithdrawalConsumer,
  readContractStart,
  retrieveWithdrawalSubscription,
  type WithdrawalReadStripe,
} from "@/lib/billing/eu-withdrawal-reads";
import { logStepFailure, updateWithdrawalMetadata, type WithdrawalRecordStripe } from "@/lib/billing/eu-withdrawal-record";
import {
  computeRefund,
  issueWithdrawalRefunds,
  listSubscriptionInvoices,
  prepareRefunds,
  type FinishResult,
  type WithdrawalRefundsStripe,
} from "@/lib/billing/eu-withdrawal-refunds";
import {
  readWithdrawalMetadata,
  selectChainEnd,
  selectResumeNext,
  selectResumeStop,
  selectWithdrawalEligibility,
  type WithdrawalEligibility,
  type WithdrawalMetadata,
  type WithdrawalRefund,
} from "@/lib/billing/eu-withdrawal-selectors";
import { callStripe, STRIPE_OPERATIONS, stripeErrorName } from "@/lib/billing/stripe-call";
import { enqueueEuWithdrawalResume } from "@/lib/scheduler/enqueue";
import { getStripe } from "@/lib/stripe";
import { sendWithdrawalReceiptEmail } from "@/utils/email";
import { classifySubscriptionItems } from "@/utils/subscription-items";
import { getTeamSubscription } from "@/utils/team-subscription";
import { withSpan } from "@/utils/trace";

// The EU consumer withdrawal: the billing page offer, the withdrawal itself, and the resume job
// that finishes it. The rules live in `eu-withdrawal-selectors.ts`, the Stripe writes of the refund
// in `eu-withdrawal-refunds.ts`, and the repairs in `eu-withdrawal-recovery.ts`.

const RESUME_INTERVAL_MS = 60 * 60 * 1000;

const OFFER_SPAN_NAME = "app.billing.eu_withdrawal.offer";
const WITHDRAW_SPAN_NAME = "app.billing.eu_withdrawal";
const RESUME_SPAN_NAME = "app.billing.eu_withdrawal.resume";
const OUTCOME_ATTRIBUTE = "app.billing.outcome";

/** The `app.billing.outcome` values of the withdrawal spans. */
const WITHDRAWAL_OUTCOMES = {
  offered: "offered",
  notOffered: "not_offered",
  // The offer read failed, so the page hides the card.
  offerUpstreamError: "upstream_error",
  notEligible: "not_eligible",
  completed: "completed",
  resumeScheduled: "resume_scheduled",
  rescheduled: "rescheduled",
  notRecorded: "not_recorded",
  // Another job of the same withdrawal owns the chain.
  superseded: "superseded",
  needsStaff: "needs_staff",
  gaveUp: "gave_up",
} as const;

// A marked withdrawal: staff own every refund, and the chain owes only the receipt.
const STAFF_OWNS_REFUNDS: FinishResult = { status: "needs_staff", reason: "already_marked", invoiceIds: [] };

/**
 * The withdrawal card of the billing page, or null when there is nothing to offer. One live Stripe
 * read, and only when the team row shows a subscription that can be withdrawn from. A failed read
 * hides the card: the page must render without Stripe.
 */
export const getWithdrawalOffer = cache(async (teamId: string): Promise<WithdrawalOffer | null> => {
  return withSpan({
    name: OFFER_SPAN_NAME,
    run: async (span) => {
      const row = await getTeamSubscription(teamId);
      const subscriptionId = row.stripeSubscriptionId;
      if (!subscriptionId || !getStripeSubscriptionTransitionPolicy(row.status)?.euWithdrawable) {
        span.setAttribute(OUTCOME_ATTRIBUTE, WITHDRAWAL_OUTCOMES.notOffered);
        return null;
      }

      try {
        const client = await getStripe();
        const subscription = await retrieveWithdrawalSubscription({ stripe: client, subscriptionId });
        const startedAt = await readContractStart({ stripe: client, subscription });
        const { eligibility } = assessWithdrawal({ subscription, startedAt, now: new Date() });
        if (!eligibility.eligible) {
          span.setAttribute(OUTCOME_ATTRIBUTE, WITHDRAWAL_OUTCOMES.notOffered);
          return null;
        }

        span.setAttribute(OUTCOME_ATTRIBUTE, WITHDRAWAL_OUTCOMES.offered);
        return {
          subscriptionId,
          planName: withdrawalPlanName({ subscription, fallbackPlanId: row.planId }),
          startedAt,
          windowEndsAt: eligibility.windowEndsAt,
          pending: eligibility.resuming,
        };
      } catch (error) {
        span.setAttribute(OUTCOME_ATTRIBUTE, WITHDRAWAL_OUTCOMES.offerUpstreamError);
        console.error(JSON.stringify({
          event: "eu_withdrawal_offer_failed",
          provider: "stripe",
          operation: "getWithdrawalOffer",
          errorName: stripeErrorName(error),
        }));
        return null;
      }
    },
  });
});

/**
 * Withdraw a consumer from the team's subscription. The resume job is saved before the claim, so
 * a claim whose response is lost still gets its cancel, refund, and receipt. `completed: false`
 * means the resume job finishes the rest.
 */
export async function withdrawFromContract({
  team,
  subscriptionId,
  actingUser,
  now,
  stripe,
}: {
  team: WithdrawalTeam;
  subscriptionId: string;
  actingUser: WithdrawingUser;
  now: Date;
  // Injectable for tests; defaults to the shared Stripe client.
  stripe?: WithdrawalStripe;
}): Promise<{ completed: boolean }> {
  return withSpan({
    name: WITHDRAW_SPAN_NAME,
    isExpected: (error) => error instanceof ActionError,
    run: async (span) => {
      const client = stripe ?? (await getStripe());
      let subscription = await retrieveWithdrawalSubscription({ stripe: client, subscriptionId });
      const startedAt = await readContractStart({ stripe: client, subscription });
      const { record: before, eligibility } = assessWithdrawal({ subscription, startedAt, now });
      if (!eligibility.eligible) {
        span.setAttribute(OUTCOME_ATTRIBUTE, WITHDRAWAL_OUTCOMES.notEligible);
        throw new ActionError("PRECONDITION_FAILED", { key: "Client.Dashboard.Billing.errorWithdrawalUnavailable" });
      }

      // The receipt states the refund, so read it before any write.
      let receiptRefund: WithdrawalRefund | undefined;
      if (!eligibility.resuming) {
        const invoices = await listSubscriptionInvoices({ stripe: client, subscription });
        receiptRefund = await computeRefund({ subscription, invoices, startedAt, withdrawnAt: now, record: before, credits: new Map() });
        subscription = await claimWithdrawal({ stripe: client, team, subscription, actingUserId: actingUser.id, now });
      }
      const record = readWithdrawalMetadata(subscription.metadata);
      const withdrawnAt = record.withdrawnAt ?? now;

      const { result, receiptSent } = await receiptThenFinish({
        stripe: client,
        subscription,
        record,
        startedAt,
        withdrawnAt,
        receipt: { teamId: team.id, team, recipient: actingUser, refund: receiptRefund },
      });

      const completed = selectChainEnd({ refunds: result.status, receiptSent }) === "completed";
      span.setAttribute(OUTCOME_ATTRIBUTE, completed ? WITHDRAWAL_OUTCOMES.completed : WITHDRAWAL_OUTCOMES.resumeScheduled);
      return { completed };
    },
  });
}

/**
 * The resume job. Only the job whose run time matches `eu_resume_at` continues, so one chain runs
 * per withdrawal. It stops when all is done, when staff must act and the receipt is sent, or after
 * the maximum age.
 * A failed reschedule throws, so the queue retries the same message, which still owns the chain.
 */
export async function resumeWithdrawal({
  teamId,
  subscriptionId,
  scheduledFor,
  now,
  stripe,
}: {
  teamId: string;
  subscriptionId: string;
  // The job's own `runAt`, as the queue message holds it.
  scheduledFor: string;
  now: Date;
  // Injectable for tests; defaults to the shared Stripe client.
  stripe?: WithdrawalStripe;
}): Promise<{ completed: boolean }> {
  return withSpan({
    name: RESUME_SPAN_NAME,
    run: async (span) => {
      const client = stripe ?? (await getStripe());
      const subscription = await callStripe({
        operation: STRIPE_OPERATIONS.subscriptionsRetrieve,
        run: () => client.subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice"] }),
      });
      const record = readWithdrawalMetadata(subscription.metadata);
      const { withdrawnAt } = record;
      const stop = selectResumeStop({ record, scheduledFor });
      if (stop || !withdrawnAt) {
        span.setAttribute(OUTCOME_ATTRIBUTE, WITHDRAWAL_OUTCOMES[stop ?? "notRecorded"]);
        return { completed: stop === "completed" };
      }

      const startedAt = await readContractStart({ stripe: client, subscription });
      const { result, receiptSent } = record.needsStaffAt
        ? { result: STAFF_OWNS_REFUNDS, receiptSent: await sendReceipt({ stripe: client, subscription, record, startedAt, receipt: { teamId } }) }
        : await receiptThenFinish({ stripe: client, subscription, record, startedAt, withdrawnAt, receipt: { teamId } });

      // A marked withdrawal already has its mark and its alert.
      if (result.status === "needs_staff" && !record.needsStaffAt) {
        await updateWithdrawalMetadata({
          stripe: client,
          subscriptionId,
          metadata: { [SUBSCRIPTION_WITHDRAWAL_METADATA.needsStaffAt]: now.toISOString() },
        });
        console.error(JSON.stringify({
          event: "eu_withdrawal_refund_needs_staff",
          subscriptionId,
          reason: result.reason,
          invoiceIds: result.invoiceIds,
          receiptSent,
        }));
      }

      const { next, overdue } = selectResumeNext({ status: result.status, receiptSent, withdrawnAt, now });
      if (next === "completed") {
        span.setAttribute(OUTCOME_ATTRIBUTE, WITHDRAWAL_OUTCOMES.completed);
        return { completed: true };
      }
      if (next === "needsStaff") {
        span.setAttribute(OUTCOME_ATTRIBUTE, WITHDRAWAL_OUTCOMES.needsStaff);
        return { completed: false };
      }
      if (next === "gaveUp") {
        console.error(JSON.stringify({ event: "eu_withdrawal_resume_gave_up", subscriptionId, receiptSent }));
        span.setAttribute(OUTCOME_ATTRIBUTE, WITHDRAWAL_OUTCOMES.gaveUp);
        return { completed: false };
      }
      if (overdue) {
        console.error(JSON.stringify({ event: "eu_withdrawal_refund_overdue", subscriptionId }));
      }

      // Enqueue first: when the metadata write then fails, the retry of this message still owns the chain.
      const nextRunAt = nextResumeAt(now);
      await enqueueEuWithdrawalResume({ teamId, subscriptionId, runAt: nextRunAt });
      await updateWithdrawalMetadata({
        stripe: client,
        subscriptionId,
        metadata: { [SUBSCRIPTION_WITHDRAWAL_METADATA.resumeAt]: nextRunAt.toISOString() },
      });
      span.setAttribute(OUTCOME_ATTRIBUTE, WITHDRAWAL_OUTCOMES.rescheduled);
      return { completed: false };
    },
  });
}

/** The name the withdrawal dialog shows and the receipt states. Both read it here, so they match. */
export function withdrawalSignerName({
  firstName,
  lastName,
  email,
}: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  const fullName = [firstName?.trim(), lastName?.trim()].filter(Boolean).join(" ");

  return (fullName || email).slice(0, NAME_MAX_LENGTH);
}

// Step 3: save the resume job, then write the claim with that job's run time. A failed claim
// may still have landed (a lost response, a fast double click), so read the subscription again.
async function claimWithdrawal({
  stripe,
  team,
  subscription,
  actingUserId,
  now,
}: {
  stripe: WithdrawalStripe;
  team: WithdrawalTeam;
  subscription: Stripe.Subscription;
  actingUserId: string;
  now: Date;
}): Promise<Stripe.Subscription> {
  const resumeAt = nextResumeAt(now);
  await enqueueEuWithdrawalResume({ teamId: team.id, subscriptionId: subscription.id, runAt: resumeAt });

  try {
    return await callStripe({
      operation: STRIPE_OPERATIONS.subscriptionsUpdate,
      run: () => stripe.subscriptions.update(subscription.id, {
        metadata: {
          // The recovery scan reads the team here; a reconcile may have matched it by customer only.
          teamId: team.id,
          [SUBSCRIPTION_WITHDRAWAL_METADATA.withdrawnAt]: now.toISOString(),
          [SUBSCRIPTION_WITHDRAWAL_METADATA.withdrawnByUserId]: actingUserId,
          [SUBSCRIPTION_WITHDRAWAL_METADATA.resumeAt]: resumeAt.toISOString(),
        },
      }, { idempotencyKey: `eu-withdrawal-record:${subscription.id}` }),
    });
  } catch (error) {
    const current = await callStripe({
      operation: STRIPE_OPERATIONS.subscriptionsRetrieve,
      run: () => stripe.subscriptions.retrieve(subscription.id),
    }).catch(() => null);
    if (current && readWithdrawalMetadata(current.metadata).withdrawnAt) {
      return current;
    }
    throw error;
  }
}

// Steps 4 to 9 (`docs/eu-withdrawal.md`). The receipt goes after the refund sum and before the credit
// notes, so it states the amount this run refunds. A failed step before it cannot hold it back.
async function receiptThenFinish({
  stripe,
  subscription,
  record,
  startedAt,
  withdrawnAt,
  receipt,
}: {
  stripe: WithdrawalStripe;
  subscription: Stripe.Subscription;
  record: WithdrawalMetadata;
  startedAt: Date;
  withdrawnAt: Date;
  receipt: ReceiptSources;
}): Promise<{ result: FinishResult; receiptSent: boolean }> {
  const subscriptionId = subscription.id;
  const preparation = await prepareRefunds({ stripe, subscription, record, startedAt, withdrawnAt });

  const receiptSent = await sendReceipt({
    stripe,
    subscription,
    record,
    startedAt,
    receipt: { ...receipt, refund: preparation.ok ? preparation.prepared.refund : receipt.refund },
  });

  const result = preparation.ok
    ? await issueWithdrawalRefunds({ stripe, subscriptionId, prepared: preparation.prepared })
    : preparation.result;

  if (selectChainEnd({ refunds: result.status, receiptSent }) === "completed") {
    await updateWithdrawalMetadata({
      stripe,
      subscriptionId,
      metadata: { [SUBSCRIPTION_WITHDRAWAL_METADATA.completedAt]: new Date().toISOString() },
    }).catch((error: unknown) => {
      // Without the mark, the recovery scan runs the job once more, and that run finds nothing to do.
      logStepFailure({ step: "complete", subscriptionId, error });
    });
  }

  return { result, receiptSent };
}

// Step 7, with its failure logged. Returns whether a receipt is now marked as sent.
async function sendReceipt({
  receipt,
  ...params
}: {
  stripe: WithdrawalStripe;
  subscription: Stripe.Subscription;
  record: WithdrawalMetadata;
  startedAt: Date;
  receipt: ReceiptSources;
}): Promise<boolean> {
  return ensureReceipt({ ...params, ...receipt }).catch((error: unknown) => {
    logStepFailure({ step: "receipt", subscriptionId: params.subscription.id, error });
    return false;
  });
}

/**
 * Step 7: send the receipt when a withdrawal is recorded and none is marked as sent, then mark it.
 * Returns whether a receipt is now marked. A second receipt after a failed mark beats none.
 */
async function ensureReceipt({
  stripe,
  subscription,
  record,
  startedAt,
  ...sources
}: ReceiptSources & {
  stripe: WithdrawalStripe;
  subscription: Stripe.Subscription;
  record: WithdrawalMetadata;
  startedAt: Date;
}): Promise<boolean> {
  const { withdrawnAt, withdrawnByUserId } = record;
  if (record.receiptSentAt) {
    return true;
  }
  if (!withdrawnAt || !withdrawnByUserId) {
    return false;
  }
  const parties = await readReceiptParties({ ...sources, withdrawnByUserId });
  if (!parties) {
    console.error(JSON.stringify({ event: "eu_withdrawal_receipt_no_recipient", subscriptionId: subscription.id }));
    return false;
  }
  const refund = sources.refund ?? await computeRefund({
    subscription,
    invoices: await listSubscriptionInvoices({ stripe, subscription }),
    startedAt,
    withdrawnAt,
    record,
    credits: new Map(),
  });

  await sendWithdrawalReceiptEmail({
    email: parties.to.email,
    name: parties.to.name,
    teamName: parties.team.name,
    planName: withdrawalPlanName({ subscription, fallbackPlanId: parties.team.subscriptionPlanId }),
    startedAt,
    withdrawnAt,
    refund: { kind: refund.kind, amount: refund.totalRefund, currency: refund.currency ?? subscription.currency },
    locale: parties.to.locale,
  });
  await updateWithdrawalMetadata({
    stripe,
    subscriptionId: subscription.id,
    metadata: { [SUBSCRIPTION_WITHDRAWAL_METADATA.receiptSentAt]: new Date().toISOString() },
  });
  return true;
}

// The user who withdrew and the team. The action passes what it read; the resume job reads D1.
async function readReceiptParties({
  teamId,
  team,
  recipient,
  withdrawnByUserId,
}: ReceiptSources & { withdrawnByUserId: string }): Promise<{ to: WithdrawingUser; team: WithdrawalTeam } | null> {
  const [to, teamRow] = await Promise.all([
    recipient?.id === withdrawnByUserId ? recipient : readRecipient(withdrawnByUserId),
    team ?? readTeam(teamId),
  ]);

  return to && teamRow ? { to, team: teamRow } : null;
}

// The page and the action decide with the same selector, so the button and the action agree.
function assessWithdrawal({
  subscription,
  startedAt,
  now,
}: {
  subscription: Stripe.Subscription;
  startedAt: Date;
  now: Date;
}): { record: WithdrawalMetadata; eligibility: WithdrawalEligibility } {
  const record = readWithdrawalMetadata(subscription.metadata);

  return {
    record,
    eligibility: selectWithdrawalEligibility({
      status: subscription.status,
      startedAt,
      isConsumer: isWithdrawalConsumer(subscription),
      withdrawnAt: record.withdrawnAt,
      now,
    }),
  };
}

async function readRecipient(userId: string): Promise<WithdrawingUser | null> {
  const user = await getDB().query.userTable.findFirst({
    where: { id: userId },
    columns: { id: true, email: true, firstName: true, lastName: true, preferredLocale: true },
  });
  if (!user?.email) {
    return null;
  }

  return {
    id: user.id,
    name: withdrawalSignerName({ firstName: user.firstName, lastName: user.lastName, email: user.email }),
    email: user.email,
    locale: user.preferredLocale ?? DEFAULT_LOCALE,
  };
}

async function readTeam(teamId: string): Promise<WithdrawalTeam | null> {
  return (await getDB().query.teamTable.findFirst({
    where: { id: teamId },
    columns: { id: true, name: true, subscriptionPlanId: true },
  })) ?? null;
}

// Whole seconds: a durable job row stores its run time in seconds, and the chain compares the two.
function nextResumeAt(now: Date): Date {
  return new Date(Math.ceil((now.getTime() + RESUME_INTERVAL_MS) / 1000) * 1000);
}

function withdrawalPlanName({
  subscription,
  fallbackPlanId,
}: {
  subscription: Stripe.Subscription;
  fallbackPlanId: string | null;
}): string {
  return getPlan(classifySubscriptionItems(subscription).planId ?? fallbackPlanId).name;
}

export interface WithdrawalOffer {
  // The dialog sends it back, so the action refuses a subscription that replaced this one.
  subscriptionId: string;
  planName: string;
  startedAt: Date;
  windowEndsAt: Date;
  // The withdrawal is recorded, and the cancel or the refund is still due.
  pending: boolean;
}

interface ReceiptSources {
  teamId: string;
  team?: WithdrawalTeam;
  recipient?: WithdrawingUser;
  // The refund this run issues, else the one the action read before its claim. Without one, the
  // receipt step reads the invoices itself.
  refund?: WithdrawalRefund;
}

interface WithdrawalTeam {
  id: string;
  name: string;
  subscriptionPlanId: string | null;
}

interface WithdrawingUser {
  id: string;
  // From `withdrawalSignerName`, so the receipt states the name the dialog showed.
  name: string;
  email: string;
  locale: Locale;
}


// The subset of the Stripe client the withdrawal drives. Narrowed so tests can pass a fake.
export type WithdrawalStripe = WithdrawalReadStripe & WithdrawalRefundsStripe & WithdrawalRecordStripe;
