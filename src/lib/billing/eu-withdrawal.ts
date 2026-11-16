import "server-only";

import { cache } from "react";
import type Stripe from "stripe";

import { DAY_IN_MS, NAME_MAX_LENGTH } from "@/constants";
import {
  CREDIT_NOTE_WITHDRAWAL_METADATA,
  REFUND_DEADLINE_DAYS,
  SUBSCRIPTION_WITHDRAWAL_METADATA,
} from "@/constants/eu-withdrawal";
import { getPlan } from "@/constants/plans";
import { getStripeSubscriptionTransitionPolicy, WITHDRAWAL_CANCEL_PARAMS } from "@/constants/subscription-lifecycle";
import { getDB } from "@/db";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { ActionError } from "@/lib/action-error";
import { readContractStart } from "@/lib/billing/contract-start";
import { getWithdrawalExtraCharges, isConsumerCustomer } from "@/lib/billing/eu-withdrawal-seams";
import {
  readWithdrawalMetadata,
  selectWithdrawalCredits,
  selectWithdrawalEligibility,
  selectWithdrawalRefund,
  toWithdrawalInvoice,
  type WithdrawalEligibility,
  type WithdrawalMetadata,
  type WithdrawalRefund,
} from "@/lib/billing/eu-withdrawal-selectors";
import { callStripe, classifyStripeError, STRIPE_OPERATIONS, stripeErrorName } from "@/lib/billing/stripe-call";
import { enqueueEuWithdrawalResume } from "@/lib/scheduler/enqueue";
import { getStripe } from "@/lib/stripe";
import { sendWithdrawalReceiptEmail } from "@/utils/email";
import { getStripeId } from "@/utils/stripe-id";
import { classifySubscriptionItems } from "@/utils/subscription-items";
import { getTeamSubscription, reconcileTeamFromSubscription } from "@/utils/team-subscription";
import { withSpan } from "@/utils/trace";

// The EU consumer withdrawal: the billing page offer, the withdrawal itself, and the resume job
// that finishes it. The rules live in `eu-withdrawal-selectors.ts`; `docs/eu-withdrawal.md` has the steps.

// Invoices of one subscription since its start. A withdrawal happens within weeks of the start.
const INVOICE_LIST_LIMIT = 100;
const INVOICE_LINE_PAGE_LIMIT = 100;
const CREDIT_NOTE_LIST_LIMIT = 100;
const PENDING_ITEM_LIST_LIMIT = 100;
const RESUME_INTERVAL_MS = 60 * 60 * 1000;
// After this, the resume job stops with one last log line. Staff take over.
const RESUME_MAX_AGE_DAYS = 30;
// Stripe records this as `cancellation_details.comment`, so the billing record names the reason.
const WITHDRAWAL_CANCEL_COMMENT = "EU right of withdrawal: the consumer withdrew from the contract";

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

// A refund needs a card or bank charge to go back to. Balance and out-of-band payments have none.
const REFUNDABLE_PAYMENT_TYPES: ReadonlySet<string> = new Set(["payment_intent", "charge"]);

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
        const subscription = await retrieveWithCustomer({ stripe: client, subscriptionId });
        const startedAt = await readContractStart({ stripe: client, subscription });
        const { eligibility } = assessWithdrawal({ subscription, startedAt, now: new Date() });
        if (!eligibility.eligible) {
          span.setAttribute(OUTCOME_ATTRIBUTE, WITHDRAWAL_OUTCOMES.notOffered);
          return null;
        }

        span.setAttribute(OUTCOME_ATTRIBUTE, WITHDRAWAL_OUTCOMES.offered);
        return {
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
      let subscription = await retrieveWithCustomer({ stripe: client, subscriptionId });
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

      const result = await receiptThenFinish({
        stripe: client,
        subscription,
        record,
        startedAt,
        withdrawnAt,
        receipt: { teamId: team.id, team, recipient: actingUser, refund: receiptRefund },
      });

      const completed = result.status === "done";
      span.setAttribute(OUTCOME_ATTRIBUTE, completed ? WITHDRAWAL_OUTCOMES.completed : WITHDRAWAL_OUTCOMES.resumeScheduled);
      return { completed };
    },
  });
}

/**
 * The resume job. Only the job whose run time matches `eu_resume_at` continues, so one chain runs
 * per withdrawal. It stops when all is done, when staff must act, or after the maximum age.
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
        return { completed: false };
      }

      const startedAt = await readContractStart({ stripe: client, subscription });
      const result = await receiptThenFinish({ stripe: client, subscription, record, startedAt, withdrawnAt, receipt: { teamId } });

      if (result.status === "done") {
        span.setAttribute(OUTCOME_ATTRIBUTE, WITHDRAWAL_OUTCOMES.completed);
        return { completed: true };
      }
      if (result.status === "needs_staff") {
        await updateWithdrawalMetadata({
          stripe: client,
          subscriptionId,
          metadata: { [SUBSCRIPTION_WITHDRAWAL_METADATA.needsStaffAt]: now.toISOString() },
        });
        console.error(JSON.stringify({ event: "eu_withdrawal_refund_needs_staff", subscriptionId, reason: result.reason }));
        span.setAttribute(OUTCOME_ATTRIBUTE, WITHDRAWAL_OUTCOMES.needsStaff);
        return { completed: false };
      }

      const ageMs = now.getTime() - withdrawnAt.getTime();
      if (ageMs >= RESUME_MAX_AGE_DAYS * DAY_IN_MS) {
        console.error(JSON.stringify({ event: "eu_withdrawal_resume_gave_up", subscriptionId }));
        span.setAttribute(OUTCOME_ATTRIBUTE, WITHDRAWAL_OUTCOMES.gaveUp);
        return { completed: false };
      }
      if (ageMs >= REFUND_DEADLINE_DAYS * DAY_IN_MS) {
        console.error(JSON.stringify({ event: "eu_withdrawal_refund_overdue", subscriptionId }));
      }

      // Enqueue first: when the metadata write then fails, the retry of this message still owns the chain.
      const next = nextResumeAt(now);
      await enqueueEuWithdrawalResume({ teamId, subscriptionId, runAt: next });
      await updateWithdrawalMetadata({
        stripe: client,
        subscriptionId,
        metadata: { [SUBSCRIPTION_WITHDRAWAL_METADATA.resumeAt]: next.toISOString() },
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

// Why a resume job stops before it does anything, or null when it continues.
function selectResumeStop({
  record,
  scheduledFor,
}: {
  record: WithdrawalMetadata;
  scheduledFor: string;
}): "notRecorded" | "superseded" | "needsStaff" | null {
  // The action saves the job before its claim; when the claim failed, there is nothing to resume.
  if (!record.withdrawnAt) {
    return "notRecorded";
  }
  if (record.resumeAt !== scheduledFor) {
    return "superseded";
  }

  return record.needsStaffAt ? "needsStaff" : null;
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

// Steps 4 to 8. The receipt goes before the cancel, so a Stripe failure after the claim cannot
// delay it. Neither step fails the caller: the resume job tries both again.
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
}): Promise<FinishResult> {
  const subscriptionId = subscription.id;
  await ensureReceipt({ stripe, subscription, record, startedAt, ...receipt })
    .catch((error: unknown) => logStepFailure({ step: "receipt", subscriptionId, error }));

  return finishWithdrawal({ stripe, subscription, record, startedAt, withdrawnAt }).catch((error: unknown): FinishResult => {
    logStepFailure({ step: "finish", subscriptionId, error });
    // A refused 4xx (a refunded charge, a dispute, a missing object) fails the same way every hour.
    return classifyStripeError(error) === "refused" ? { status: "needs_staff", reason: "stripe_refused" } : { status: "retry" };
  });
}

/**
 * Step 4: send the receipt when a withdrawal is recorded and no receipt is marked as sent, then
 * mark it. A failure between the two sends a second receipt later; that is better than none.
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
}): Promise<void> {
  const { withdrawnAt, withdrawnByUserId } = record;
  if (!withdrawnAt || !withdrawnByUserId || record.receiptSentAt) {
    return;
  }
  const parties = await readReceiptParties({ ...sources, withdrawnByUserId });
  if (!parties) {
    console.error(JSON.stringify({ event: "eu_withdrawal_receipt_no_recipient", subscriptionId: subscription.id }));
    return;
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

// Steps 5 to 8: cancel, clear what could still bill, sync the team, refund. The invoice read comes
// after the cancel, so it sees every payment that landed before Stripe stopped collecting.
async function finishWithdrawal({
  stripe,
  subscription,
  record,
  startedAt,
  withdrawnAt,
}: {
  stripe: WithdrawalStripe;
  subscription: Stripe.Subscription;
  record: WithdrawalMetadata;
  startedAt: Date;
  withdrawnAt: Date;
}): Promise<FinishResult> {
  const ended = await cancelUnlessEnded({ stripe, subscription });
  const invoices = await listSubscriptionInvoices({ stripe, subscription });
  await clearUnbilled({ stripe, subscription, invoices });
  await reconcileAfterCancel(ended);

  const creditNotes = await listCreditNotes({ stripe, invoices });
  const refund = await computeRefund({
    subscription,
    invoices,
    startedAt,
    withdrawnAt,
    record,
    credits: selectWithdrawalCredits({ creditNotes, subscriptionId: subscription.id }),
  });

  return issueWithdrawalRefunds({ stripe, subscriptionId: subscription.id, invoices, refund });
}

// `WITHDRAWAL_CANCEL_PARAMS`, not `cancelParamsForStatus`: a final invoice would bill the consumer
// after the refund was computed (`src/constants/subscription-lifecycle.ts`).
async function cancelUnlessEnded({
  stripe,
  subscription,
}: {
  stripe: WithdrawalStripe;
  subscription: Stripe.Subscription;
}): Promise<Stripe.Subscription> {
  if (getStripeSubscriptionTransitionPolicy(subscription.status)?.subscription === "clear") {
    return subscription;
  }

  return callStripe({
    operation: STRIPE_OPERATIONS.subscriptionsCancel,
    run: () => stripe.subscriptions.cancel(subscription.id, {
      ...WITHDRAWAL_CANCEL_PARAMS,
      cancellation_details: { comment: WITHDRAWAL_CANCEL_COMMENT },
    }, { idempotencyKey: `eu-withdrawal-cancel:${subscription.id}` }),
  });
}

// After the cancel, nothing of this subscription may bill: a draft (a trial end) can finalize and
// charge, an open invoice stays collectable, and pending items (prorations) join the next invoice.
async function clearUnbilled({
  stripe,
  subscription,
  invoices,
}: {
  stripe: WithdrawalStripe;
  subscription: Stripe.Subscription;
  invoices: Stripe.Invoice[];
}): Promise<void> {
  for (const invoice of invoices) {
    if (invoice.status === "draft") {
      await callStripe({
        operation: STRIPE_OPERATIONS.invoicesDelete,
        run: () => stripe.invoices.del(invoice.id),
      });
    } else if (invoice.status === "open") {
      await callStripe({
        operation: STRIPE_OPERATIONS.invoicesVoid,
        run: () => stripe.invoices.voidInvoice(invoice.id, {}, { idempotencyKey: `eu-withdrawal-void:${invoice.id}` }),
      });
    }
  }

  const customerId = getStripeId(subscription.customer);
  if (!customerId) {
    return;
  }
  const { data: pendingItems } = await callStripe({
    operation: STRIPE_OPERATIONS.invoiceItemsList,
    run: () => stripe.invoiceItems.list({ customer: customerId, pending: true, limit: PENDING_ITEM_LIST_LIMIT }),
  });
  for (const item of pendingItems) {
    if (item.parent?.subscription_details?.subscription === subscription.id) {
      await callStripe({
        operation: STRIPE_OPERATIONS.invoiceItemsDelete,
        run: () => stripe.invoiceItems.del(item.id),
      });
    }
  }
}

// The webhook syncs the team row too, so a failed write here only delays the page.
async function reconcileAfterCancel(subscription: Stripe.Subscription): Promise<void> {
  await reconcileTeamFromSubscription({ subscription }).catch((error: unknown) => {
    logStepFailure({ step: "reconcile", subscriptionId: subscription.id, error });
  });
}

/**
 * One credit note with a refund per invoice that still owes one. An invoice with no charge is
 * left to staff; the other refunds still go out. The caller logs and marks the staff case.
 */
async function issueWithdrawalRefunds({
  stripe,
  subscriptionId,
  invoices,
  refund,
}: {
  stripe: WithdrawalStripe;
  subscriptionId: string;
  invoices: Stripe.Invoice[];
  refund: WithdrawalRefund;
}): Promise<FinishResult> {
  let needsStaff = false;
  for (const { invoiceId, refundNow } of refund.perInvoice) {
    if (refundNow <= 0) {
      continue;
    }
    const invoice = invoices.find(({ id }) => id === invoiceId);
    if (!invoice || !hasRefundableCharge(invoice)) {
      needsStaff = true;
      continue;
    }

    await callStripe({
      operation: STRIPE_OPERATIONS.creditNotesCreate,
      run: () => stripe.creditNotes.create({
        invoice: invoiceId,
        amount: refundNow,
        refund_amount: refundNow,
        metadata: { [CREDIT_NOTE_WITHDRAWAL_METADATA.subscriptionId]: subscriptionId },
      }, { idempotencyKey: `eu-withdrawal-refund:${invoiceId}` }),
    });
  }

  return needsStaff ? { status: "needs_staff", reason: "no_charge" } : { status: "done" };
}

// The extra-charges seam runs only with consent: without it the consumer owes nothing (art. 14(4)).
async function computeRefund({
  subscription,
  invoices,
  startedAt,
  withdrawnAt,
  record,
  credits,
}: {
  subscription: Stripe.Subscription;
  invoices: Stripe.Invoice[];
  startedAt: Date;
  withdrawnAt: Date;
  record: WithdrawalMetadata;
  // Our earlier refunds per invoice. The receipt states the whole refund, so it passes none.
  credits: ReadonlyMap<string, number>;
}): Promise<WithdrawalRefund> {
  const consent = record.consent !== null;
  const extraCharges = consent ? await getWithdrawalExtraCharges({ subscription, withdrawnAt }) : 0;

  return selectWithdrawalRefund({
    invoices: invoices
      .filter(({ status }) => status === "paid")
      .map((invoice) => toWithdrawalInvoice({ invoice, alreadyCredited: credits.get(invoice.id) ?? 0 })),
    startedAt,
    withdrawnAt,
    consent,
    extraCharges,
  });
}

// The invoices of every status since the start. `payments` tells a charge from a balance payment.
async function listSubscriptionInvoices({
  stripe,
  subscription,
}: {
  stripe: WithdrawalStripe;
  subscription: Stripe.Subscription;
}): Promise<Stripe.Invoice[]> {
  const { data } = await callStripe({
    operation: STRIPE_OPERATIONS.invoicesList,
    run: () => stripe.invoices.list({
      subscription: subscription.id,
      created: { gte: subscription.start_date },
      limit: INVOICE_LIST_LIMIT,
      expand: ["data.payments"],
    }),
  });

  // Few invoices count toward a refund, and only a paid one needs every line for the used share.
  const complete: Stripe.Invoice[] = [];
  for (const invoice of data) {
    complete.push(invoice.status === "paid" && invoice.lines?.has_more
      ? { ...invoice, lines: { ...invoice.lines, data: await listAllLines({ stripe, invoice }), has_more: false } }
      : invoice);
  }

  return complete;
}

// `invoices.list` returns only the first page of lines. The refund weighs every line.
async function listAllLines({
  stripe,
  invoice,
}: {
  stripe: WithdrawalStripe;
  invoice: Stripe.Invoice;
}): Promise<Stripe.InvoiceLineItem[]> {
  const lines: Stripe.InvoiceLineItem[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const cursor = startingAfter;
    const page = await callStripe({
      operation: STRIPE_OPERATIONS.invoicesListLineItems,
      run: () => stripe.invoices.listLineItems(invoice.id, {
        limit: INVOICE_LINE_PAGE_LIMIT,
        ...(cursor ? { starting_after: cursor } : {}),
      }),
    });
    lines.push(...page.data);
    startingAfter = page.data.at(-1)?.id;
    if (!page.has_more || !startingAfter) {
      return lines;
    }
  }
}

// The credit notes of each paid invoice. `selectWithdrawalCredits` keeps only ours.
async function listCreditNotes({
  stripe,
  invoices,
}: {
  stripe: WithdrawalStripe;
  invoices: Stripe.Invoice[];
}): Promise<Stripe.CreditNote[]> {
  const notes: Stripe.CreditNote[] = [];
  for (const invoice of invoices.filter(({ status, amount_paid }) => status === "paid" && amount_paid > 0)) {
    const { data } = await callStripe({
      operation: STRIPE_OPERATIONS.creditNotesList,
      run: () => stripe.creditNotes.list({ invoice: invoice.id, limit: CREDIT_NOTE_LIST_LIMIT }),
    });
    notes.push(...data);
  }

  return notes;
}

// No idempotency key: the values differ on each call, and writing the same keys twice is harmless.
async function updateWithdrawalMetadata({
  stripe,
  subscriptionId,
  metadata,
}: {
  stripe: WithdrawalStripe;
  subscriptionId: string;
  metadata: Record<string, string>;
}): Promise<void> {
  await callStripe({
    operation: STRIPE_OPERATIONS.subscriptionsUpdate,
    run: () => stripe.subscriptions.update(subscriptionId, { metadata }),
  });
}

// `isConsumerCustomer` needs the customer's tax IDs, and `readContractStart` the first invoice.
function retrieveWithCustomer({
  stripe,
  subscriptionId,
}: {
  stripe: WithdrawalStripe;
  subscriptionId: string;
}): Promise<Stripe.Subscription> {
  return callStripe({
    operation: STRIPE_OPERATIONS.subscriptionsRetrieve,
    run: () => stripe.subscriptions.retrieve(subscriptionId, { expand: ["customer.tax_ids", "latest_invoice"] }),
  });
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
  if (typeof subscription.customer === "string") {
    throw new TypeError("The withdrawal needs the subscription with its customer expanded");
  }
  const record = readWithdrawalMetadata(subscription.metadata);

  return {
    record,
    eligibility: selectWithdrawalEligibility({
      status: subscription.status,
      startedAt,
      isConsumer: isConsumerCustomer(subscription.customer),
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

function hasRefundableCharge(invoice: Stripe.Invoice): boolean {
  return (invoice.payments?.data ?? []).some((payment) => payment.status === "paid"
    && REFUNDABLE_PAYMENT_TYPES.has(payment.payment.type));
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

function logStepFailure({ step, subscriptionId, error }: { step: string; subscriptionId: string; error: unknown }): void {
  console.error(JSON.stringify({ event: "eu_withdrawal_step_failed", step, subscriptionId, errorName: stripeErrorName(error) }));
}

type FinishResult =
  | { status: "done" }
  | { status: "retry" }
  | { status: "needs_staff"; reason: "no_charge" | "stripe_refused" };

export interface WithdrawalOffer {
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
  // The refund the action read before its claim; the resume job reads it again.
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
export interface WithdrawalStripe {
  subscriptions: {
    retrieve: (id: string, params?: Stripe.SubscriptionRetrieveParams) => Promise<Stripe.Subscription>;
    update: (
      id: string,
      params: Stripe.SubscriptionUpdateParams,
      options?: Stripe.RequestOptions,
    ) => Promise<Stripe.Subscription>;
    cancel: (
      id: string,
      params: Stripe.SubscriptionCancelParams,
      options: Stripe.RequestOptions,
    ) => Promise<Stripe.Subscription>;
  };
  invoices: {
    list: (params: Stripe.InvoiceListParams) => Promise<{ data: Stripe.Invoice[] }>;
    retrieve: (id: string) => Promise<Stripe.Invoice>;
    listLineItems: (
      id: string,
      params: Stripe.InvoiceListLineItemsParams,
    ) => Promise<{ data: Stripe.InvoiceLineItem[]; has_more: boolean }>;
    voidInvoice: (
      id: string,
      params: Stripe.InvoiceVoidInvoiceParams,
      options: Stripe.RequestOptions,
    ) => Promise<Stripe.Invoice>;
    del: (id: string) => Promise<Stripe.DeletedInvoice>;
  };
  invoiceItems: {
    list: (params: Stripe.InvoiceItemListParams) => Promise<{ data: Stripe.InvoiceItem[] }>;
    del: (id: string) => Promise<Stripe.DeletedInvoiceItem>;
  };
  creditNotes: {
    create: (params: Stripe.CreditNoteCreateParams, options: Stripe.RequestOptions) => Promise<Stripe.CreditNote>;
    list: (params: Stripe.CreditNoteListParams) => Promise<{ data: Stripe.CreditNote[] }>;
  };
}
