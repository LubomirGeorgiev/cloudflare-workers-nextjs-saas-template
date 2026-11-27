import "server-only";

import type Stripe from "stripe";

import { DAY_IN_MS } from "@/constants";
import {
  RESUME_MAX_AGE_DAYS,
  SUBSCRIPTION_WITHDRAWAL_METADATA,
  WITHDRAWAL_PERIOD_DAYS,
} from "@/constants/eu-withdrawal";
import { updateWithdrawalMetadata, type WithdrawalRecordStripe } from "@/lib/billing/eu-withdrawal-record";
import {
  readWithdrawalMetadata,
  selectRefundWithdrawal,
  selectStalledWithdrawal,
} from "@/lib/billing/eu-withdrawal-selectors";
import { callStripe, STRIPE_OPERATIONS, stripeErrorName } from "@/lib/billing/stripe-call";
import { enqueueEuWithdrawalResume } from "@/lib/scheduler/enqueue";
import { getStripe } from "@/lib/stripe";
import { mapInBatches } from "@/utils/map-in-batches";
import { getStripeId } from "@/utils/stripe-id";
import { reconcileTeamFromSubscription } from "@/utils/team-subscription";

// The two paths that repair a withdrawal outside its resume chain: the daily scan for a chain that
// the queue dropped, and the `refund.failed` webhook. `docs/eu-withdrawal.md` has the rules.

// The recovery scan reads at most this many search pages of this size, and re-enqueues this many
// chains at a time.
const RECOVERY_SEARCH_PAGE_LIMIT = 100;
const RECOVERY_MAX_PAGES = 10;
const RECOVERY_BATCH_SIZE = 10;
// A withdrawal comes in the window, which ends at most about 17 days after the subscription was made.
const RECOVERY_CREATED_WINDOW_DAYS = WITHDRAWAL_PERIOD_DAYS + 3 + RESUME_MAX_AGE_DAYS;
const CREDIT_NOTE_LIST_LIMIT = 100;
const INVOICE_PAYMENT_LIST_LIMIT = 10;

/**
 * The daily recovery scan. The queue drops a job after its last retry, and then no job continues
 * the chain. This finds each withdrawal whose chain stopped and enqueues the job that
 * `eu_resume_at` names, so `selectResumeStop` lets it continue. Returns how many it enqueued.
 */
export async function recoverStalledWithdrawals({
  now,
  stripe,
}: {
  now: Date;
  // Injectable for tests; defaults to the shared Stripe client.
  stripe?: WithdrawalScanStripe;
}): Promise<number> {
  const client = stripe ?? (await getStripe());
  const createdAfter = Math.floor((now.getTime() - RECOVERY_CREATED_WINDOW_DAYS * DAY_IN_MS) / 1000);
  const query = `-metadata["${SUBSCRIPTION_WITHDRAWAL_METADATA.withdrawnAt}"]:null AND created>${createdAfter}`;
  const stalled: Stripe.Subscription[] = [];
  let page: string | undefined;
  for (let pages = 0; pages < RECOVERY_MAX_PAGES; pages += 1) {
    const cursor = page;
    const result = await callStripe({
      operation: STRIPE_OPERATIONS.subscriptionsSearch,
      run: () => client.subscriptions.search({ query, limit: RECOVERY_SEARCH_PAGE_LIMIT, ...(cursor ? { page: cursor } : {}) }),
    });
    stalled.push(...result.data.filter((subscription) => selectStalledWithdrawal({
      record: readWithdrawalMetadata(subscription.metadata),
      now,
    })));
    page = result.has_more && result.next_page ? result.next_page : undefined;
    if (!page) {
      break;
    }
  }
  if (page) {
    console.error(JSON.stringify({ event: "eu_withdrawal_recovery_truncated", pages: RECOVERY_MAX_PAGES }));
  }

  const enqueued = await mapInBatches({
    items: stalled,
    batchSize: RECOVERY_BATCH_SIZE,
    fn: (subscription) => recoverChain(subscription),
  });

  return enqueued.filter(Boolean).length;
}

/**
 * The `refund.failed` webhook. A refund can fail days after its credit note, for example on a
 * closed card. When it is a withdrawal refund, record the failure for staff. The resume chain goes
 * on, so the other invoices still get their refunds. Returns whether it was a withdrawal refund.
 */
export async function flagFailedWithdrawalRefund({
  refund,
  stripe,
}: {
  refund: Stripe.Refund;
  // Injectable for tests; defaults to the shared Stripe client.
  stripe?: FailedRefundStripe;
}): Promise<boolean> {
  const paymentIntentId = getStripeId(refund.payment_intent);
  if (!paymentIntentId) {
    return false;
  }
  const client = stripe ?? (await getStripe());
  const { data: payments } = await callStripe({
    operation: STRIPE_OPERATIONS.invoicePaymentsList,
    run: () => client.invoicePayments.list({
      payment: { type: "payment_intent", payment_intent: paymentIntentId },
      limit: INVOICE_PAYMENT_LIST_LIMIT,
    }),
  });

  for (const invoiceId of payments.map(({ invoice }) => getStripeId(invoice))) {
    if (!invoiceId) {
      continue;
    }
    const { data: creditNotes } = await callStripe({
      operation: STRIPE_OPERATIONS.creditNotesList,
      run: () => client.creditNotes.list({ invoice: invoiceId, limit: CREDIT_NOTE_LIST_LIMIT }),
    });
    const subscriptionId = selectRefundWithdrawal({ creditNotes, refundId: refund.id });
    if (subscriptionId) {
      // The alert goes first: a failed write throws so that Stripe retries, and the alert must still fire.
      console.error(JSON.stringify({
        event: "eu_withdrawal_refund_failed",
        subscriptionId,
        invoiceId,
        refundId: refund.id,
        failureReason: refund.failure_reason ?? null,
      }));
      await updateWithdrawalMetadata({
        stripe: client,
        subscriptionId,
        metadata: { [SUBSCRIPTION_WITHDRAWAL_METADATA.refundFailedAt]: new Date().toISOString() },
      });
      return true;
    }
  }

  return false;
}

// Enqueues the job that `eu_resume_at` names. One failure must not stop the other recoveries.
async function recoverChain(subscription: Stripe.Subscription): Promise<boolean> {
  const { resumeAt } = readWithdrawalMetadata(subscription.metadata);
  let teamId: string | null = null;
  try {
    teamId = resumeAt ? await readChainTeamId(subscription) : null;
  } catch (error) {
    logRecoveryFailure({ subscriptionId: subscription.id, reason: "team_lookup_failed", operation: "reconcileTeamFromSubscription", error });
    return false;
  }
  if (!resumeAt || !teamId) {
    console.error(JSON.stringify({ event: "eu_withdrawal_resume_recovery_failed", subscriptionId: subscription.id, reason: "no_team" }));
    return false;
  }

  try {
    await enqueueEuWithdrawalResume({ teamId, subscriptionId: subscription.id, runAt: new Date(resumeAt) });
  } catch (error) {
    logRecoveryFailure({ subscriptionId: subscription.id, reason: "enqueue_failed", operation: "enqueueEuWithdrawalResume", error });
    return false;
  }
  // A recovered chain is a failure that nobody saw, so it gets its own alert.
  console.error(JSON.stringify({ event: "eu_withdrawal_resume_recovered", subscriptionId: subscription.id }));
  return true;
}

// The claim writes `teamId`, but an older record may lack it. Reconcile then finds the team as the
// webhook does, by the customer of record; the resume job makes the same write after its cancel.
async function readChainTeamId(subscription: Stripe.Subscription): Promise<string | null> {
  return subscription.metadata?.teamId || reconcileTeamFromSubscription({ subscription });
}

function logRecoveryFailure({
  subscriptionId,
  reason,
  operation,
  error,
}: {
  subscriptionId: string;
  reason: "team_lookup_failed" | "enqueue_failed";
  operation: string;
  error: unknown;
}): void {
  console.error(JSON.stringify({
    event: "eu_withdrawal_resume_recovery_failed",
    subscriptionId,
    reason,
    provider: "d1",
    operation,
    errorName: stripeErrorName(error),
  }));
}

// The subsets of the Stripe client the two paths drive. Narrowed so tests can pass a fake.
interface WithdrawalScanStripe {
  subscriptions: {
    search: (params: Stripe.SubscriptionSearchParams) => Promise<{
      data: Stripe.Subscription[];
      has_more: boolean;
      next_page: string | null;
    }>;
  };
}

type FailedRefundStripe = WithdrawalRecordStripe & {
  invoicePayments: {
    list: (params: Stripe.InvoicePaymentListParams) => Promise<{ data: Stripe.InvoicePayment[] }>;
  };
  creditNotes: {
    list: (params: Stripe.CreditNoteListParams) => Promise<{ data: Stripe.CreditNote[] }>;
  };
};
