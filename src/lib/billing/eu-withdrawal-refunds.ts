import "server-only";

import type Stripe from "stripe";

import { CREDIT_NOTE_WITHDRAWAL_METADATA } from "@/constants/eu-withdrawal";
import { getStripeSubscriptionTransitionPolicy, WITHDRAWAL_CANCEL_PARAMS } from "@/constants/subscription-lifecycle";
import { logStepFailure } from "@/lib/billing/eu-withdrawal-record";
import { getWithdrawalExtraCharges } from "@/lib/billing/eu-withdrawal-seams";
import {
  selectInvoiceCreditable,
  selectWithdrawalCredits,
  selectWithdrawalRefund,
  toWithdrawalInvoice,
  type WithdrawalMetadata,
  type WithdrawalRefund,
} from "@/lib/billing/eu-withdrawal-selectors";
import { callStripe, classifyStripeError, STRIPE_OPERATIONS } from "@/lib/billing/stripe-call";
import { getStripeId } from "@/utils/stripe-id";
import { reconcileTeamFromSubscription } from "@/utils/team-subscription";

// The Stripe writes of the withdrawal: the cancel, the void of what could still bill (step 5), and
// the credit notes that refund (step 8). `docs/eu-withdrawal.md` has the steps.

// Invoices of one subscription since its start. A withdrawal happens within weeks of the start.
const INVOICE_LIST_LIMIT = 100;
const INVOICE_LINE_PAGE_LIMIT = 100;
const CREDIT_NOTE_LIST_LIMIT = 100;
const PENDING_ITEM_LIST_LIMIT = 100;
// Stripe records this as `cancellation_details.comment`, so the billing record names the reason.
const WITHDRAWAL_CANCEL_COMMENT = "EU right of withdrawal: the consumer withdrew from the contract";

// A refund needs a card or bank charge to go back to. Balance and out-of-band payments have none.
const REFUNDABLE_PAYMENT_TYPES: ReadonlySet<string> = new Set(["payment_intent", "charge"]);

/**
 * Steps 4 to 6 and the refund sum of step 8. The invoice read comes after the cancel, so it sees
 * every payment that landed before Stripe stopped collecting. A failure comes back as its result.
 */
export async function prepareRefunds(params: {
  stripe: WithdrawalRefundsStripe;
  subscription: Stripe.Subscription;
  record: WithdrawalMetadata;
  startedAt: Date;
  withdrawnAt: Date;
}): Promise<PrepareResult> {
  try {
    return { ok: true, prepared: await readRefunds(params) };
  } catch (error) {
    logStepFailure({ step: "finish", subscriptionId: params.subscription.id, error });
    return { ok: false, result: finishFailure(error) };
  }
}

/**
 * Step 8: one credit note with a refund per invoice that still owes one. An invoice with no charge,
 * a refused credit note, or a refund above what Stripe can still credit goes to staff. The other
 * refunds still go out. The caller logs and marks the staff case.
 */
export async function issueWithdrawalRefunds(params: {
  stripe: WithdrawalRefundsStripe;
  subscriptionId: string;
  prepared: PreparedRefunds;
}): Promise<FinishResult> {
  try {
    return await createCreditNotes(params);
  } catch (error) {
    logStepFailure({ step: "refund", subscriptionId: params.subscriptionId, error });
    return finishFailure(error);
  }
}

// The extra-charges seam runs only with consent: without it the consumer owes nothing (art. 14(4)).
export async function computeRefund({
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
export async function listSubscriptionInvoices({
  stripe,
  subscription,
}: {
  stripe: WithdrawalRefundsStripe;
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

async function readRefunds({
  stripe,
  subscription,
  record,
  startedAt,
  withdrawnAt,
}: {
  stripe: WithdrawalRefundsStripe;
  subscription: Stripe.Subscription;
  record: WithdrawalMetadata;
  startedAt: Date;
  withdrawnAt: Date;
}): Promise<PreparedRefunds> {
  const ended = await cancelUnlessEnded({ stripe, subscription });
  const invoices = await listSubscriptionInvoices({ stripe, subscription });
  const refusedClears = await clearUnbilled({ stripe, subscription, invoices });
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

  return { invoices, creditNotes, refund, refusedClears };
}

// `WITHDRAWAL_CANCEL_PARAMS`, not `cancelParamsForStatus`: a final invoice would bill the consumer
// after the refund was computed (`src/constants/subscription-lifecycle.ts`).
async function cancelUnlessEnded({
  stripe,
  subscription,
}: {
  stripe: WithdrawalRefundsStripe;
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

/**
 * After the cancel, nothing of this subscription may bill: a draft (a trial end, a threshold) can
 * finalize and charge, an open invoice stays collectable, and pending items join the next invoice.
 * Returns the invoices that Stripe refused to void. The refunds of the other invoices still go out.
 */
async function clearUnbilled({
  stripe,
  subscription,
  invoices,
}: {
  stripe: WithdrawalRefundsStripe;
  subscription: Stripe.Subscription;
  invoices: Stripe.Invoice[];
}): Promise<string[]> {
  const refused: string[] = [];
  for (const invoice of invoices) {
    if (invoice.status !== "draft" && invoice.status !== "open") {
      continue;
    }
    try {
      await voidUnpaid({ stripe, invoice });
    } catch (error) {
      if (classifyStripeError(error) !== "refused") {
        throw error;
      }
      logStepFailure({ step: "clear", subscriptionId: subscription.id, error });
      refused.push(invoice.id);
    }
  }

  const customerId = getStripeId(subscription.customer);
  if (!customerId) {
    return refused;
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

  return refused;
}

// Stripe deletes only a one-off draft; a subscription draft must be finalized, then voided.
// `auto_advance: false` keeps Stripe from charging it between the two calls.
async function voidUnpaid({ stripe, invoice }: { stripe: WithdrawalRefundsStripe; invoice: Stripe.Invoice }): Promise<void> {
  const unpaid = invoice.status === "draft"
    ? await callStripe({
      operation: STRIPE_OPERATIONS.invoicesFinalize,
      run: () => stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: false }, {
        idempotencyKey: `eu-withdrawal-finalize:${invoice.id}`,
      }),
    })
    : invoice;
  // A draft with a zero total is paid when it is finalized, so there is nothing to void.
  if (unpaid.status !== "open") {
    return;
  }

  await callStripe({
    operation: STRIPE_OPERATIONS.invoicesVoid,
    run: () => stripe.invoices.voidInvoice(invoice.id, {}, { idempotencyKey: `eu-withdrawal-void:${invoice.id}` }),
  });
}

// The webhook syncs the team row too, so a failed write here only delays the page.
async function reconcileAfterCancel(subscription: Stripe.Subscription): Promise<void> {
  await reconcileTeamFromSubscription({ subscription }).catch((error: unknown) => {
    logStepFailure({ step: "reconcile", subscriptionId: subscription.id, error });
  });
}

async function createCreditNotes({
  stripe,
  subscriptionId,
  prepared: { invoices, creditNotes, refund, refusedClears },
}: {
  stripe: WithdrawalRefundsStripe;
  subscriptionId: string;
  prepared: PreparedRefunds;
}): Promise<FinishResult> {
  const noCharge: string[] = [];
  const refused = [...refusedClears];
  const capped: string[] = [];
  for (const { invoiceId, refundNow } of refund.perInvoice) {
    if (refundNow <= 0) {
      continue;
    }
    const invoice = invoices.find(({ id }) => id === invoiceId);
    if (!invoice || !hasRefundableCharge(invoice)) {
      noCharge.push(invoiceId);
      continue;
    }

    try {
      const creditable = selectInvoiceCreditable({
        amountPaid: invoice.amount_paid,
        postPaymentCreditNotesAmount: invoice.post_payment_credit_notes_amount ?? 0,
        chargeAmountRefunded: await readChargeAmountRefunded({ stripe, invoice }),
        creditNotes: creditNotes.filter((note) => getStripeId(note.invoice) === invoiceId),
      });
      const amount = Math.min(refundNow, creditable);
      if (amount < refundNow) {
        capped.push(invoiceId);
      }
      if (amount <= 0) {
        continue;
      }
      await callStripe({
        operation: STRIPE_OPERATIONS.creditNotesCreate,
        run: () => stripe.creditNotes.create({
          invoice: invoiceId,
          amount,
          refund_amount: amount,
          metadata: { [CREDIT_NOTE_WITHDRAWAL_METADATA.subscriptionId]: subscriptionId },
        }, { idempotencyKey: `eu-withdrawal-refund:${invoiceId}` }),
      });
    } catch (error) {
      if (classifyStripeError(error) !== "refused") {
        throw error;
      }
      logStepFailure({ step: "refund", subscriptionId, error });
      refused.push(invoiceId);
    }
  }

  const invoiceIds = [...refused, ...capped, ...noCharge];
  if (invoiceIds.length === 0) {
    return { status: "done" };
  }
  const reason = refused.length > 0 ? "stripe_refused" : capped.length > 0 ? "refund_capped" : "no_charge";

  return { status: "needs_staff", reason, invoiceIds };
}

// The refunded sum of the invoice's charges. `invoices.list` cannot expand it this deep, so the
// flow reads it only for an invoice that gets a refund.
async function readChargeAmountRefunded({
  stripe,
  invoice,
}: {
  stripe: WithdrawalRefundsStripe;
  invoice: Stripe.Invoice;
}): Promise<number> {
  let total = 0;
  for (const { status, payment } of invoice.payments?.data ?? []) {
    const paymentIntentId = status === "paid" ? getStripeId(payment.payment_intent ?? null) : null;
    const chargeId = status === "paid" ? getStripeId(payment.charge ?? null) : null;
    if (paymentIntentId) {
      const intent = await callStripe({
        operation: STRIPE_OPERATIONS.paymentIntentsRetrieve,
        run: () => stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] }),
      });
      total += typeof intent.latest_charge === "object" && intent.latest_charge ? intent.latest_charge.amount_refunded : 0;
    } else if (chargeId) {
      const charge = await callStripe({
        operation: STRIPE_OPERATIONS.chargesRetrieve,
        run: () => stripe.charges.retrieve(chargeId),
      });
      total += charge.amount_refunded;
    }
  }

  return total;
}

// `invoices.list` returns only the first page of lines. The refund weighs every line.
async function listAllLines({
  stripe,
  invoice,
}: {
  stripe: WithdrawalRefundsStripe;
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
  stripe: WithdrawalRefundsStripe;
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

// A refused 4xx (a refunded charge, a dispute, a missing object) fails the same way every hour.
function finishFailure(error: unknown): FinishResult {
  return classifyStripeError(error) === "refused"
    ? { status: "needs_staff", reason: "stripe_refused", invoiceIds: [] }
    : { status: "retry" };
}

function hasRefundableCharge(invoice: Stripe.Invoice): boolean {
  return (invoice.payments?.data ?? []).some((payment) => payment.status === "paid"
    && REFUNDABLE_PAYMENT_TYPES.has(payment.payment.type));
}

export type FinishResult =
  | { status: "done" }
  | { status: "retry" }
  | {
    status: "needs_staff";
    // `already_marked`: an earlier run marked the withdrawal, so staff own every refund.
    reason: "no_charge" | "stripe_refused" | "refund_capped" | "already_marked";
    invoiceIds: string[];
  };

// Tagged, so the caller knows without a shape test whether the refunds can go out.
type PrepareResult = { ok: true; prepared: PreparedRefunds } | { ok: false; result: FinishResult };

interface PreparedRefunds {
  invoices: Stripe.Invoice[];
  creditNotes: Stripe.CreditNote[];
  refund: WithdrawalRefund;
  // The drafts and open invoices that Stripe refused to void.
  refusedClears: string[];
}

// The subset of the Stripe client the refund steps drive. Narrowed so tests can pass a fake.
export interface WithdrawalRefundsStripe {
  subscriptions: {
    cancel: (
      id: string,
      params: Stripe.SubscriptionCancelParams,
      options: Stripe.RequestOptions,
    ) => Promise<Stripe.Subscription>;
  };
  invoices: {
    list: (params: Stripe.InvoiceListParams) => Promise<{ data: Stripe.Invoice[] }>;
    listLineItems: (
      id: string,
      params: Stripe.InvoiceListLineItemsParams,
    ) => Promise<{ data: Stripe.InvoiceLineItem[]; has_more: boolean }>;
    voidInvoice: (
      id: string,
      params: Stripe.InvoiceVoidInvoiceParams,
      options: Stripe.RequestOptions,
    ) => Promise<Stripe.Invoice>;
    finalizeInvoice: (
      id: string,
      params: Stripe.InvoiceFinalizeInvoiceParams,
      options: Stripe.RequestOptions,
    ) => Promise<Stripe.Invoice>;
  };
  paymentIntents: {
    retrieve: (id: string, params: Stripe.PaymentIntentRetrieveParams) => Promise<Stripe.PaymentIntent>;
  };
  charges: {
    retrieve: (id: string) => Promise<Stripe.Charge>;
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
