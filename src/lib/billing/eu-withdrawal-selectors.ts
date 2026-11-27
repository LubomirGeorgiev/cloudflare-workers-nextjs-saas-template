import type Stripe from "stripe";

import { DAY_IN_MS } from "@/constants";
import {
  CONSENT_TEXT_VERSION,
  CREDIT_NOTE_WITHDRAWAL_METADATA,
  REFUND_DEADLINE_DAYS,
  RESUME_MAX_AGE_DAYS,
  RESUME_STALL_AFTER_MS,
  SUBSCRIPTION_WITHDRAWAL_METADATA,
  WITHDRAWAL_PERIOD_DAYS,
  WITHDRAWAL_WINDOW_GRACE_MS,
  WITHDRAWAL_ZONE_OFFSET_MS,
  type WithdrawalRefundKind,
} from "@/constants/eu-withdrawal";
import {
  getStripeSubscriptionTransitionPolicy,
  STRIPE_SUBSCRIPTION_TRANSITION_POLICY,
} from "@/constants/subscription-lifecycle";
import { getStripeId } from "@/utils/stripe-id";

// Pure decisions of the EU withdrawal flow. The billing page and the withdrawal action call the
// same selectors, so the button and the action can never disagree.

// From the lifecycle policy: a status that gives access starts the contract, and a status in which
// the subscription never ran or ran out (nothing to invoice on cancel) comes before a new order.
const POLICY_ENTRIES = Object.entries(STRIPE_SUBSCRIPTION_TRANSITION_POLICY);
const ACTIVATED_STATUSES: ReadonlySet<string> = new Set(
  POLICY_ENTRIES.filter(([, policy]) => policy.grantsPaidAccess).map(([status]) => status),
);
const NOT_YET_ORDERED_STATUSES: ReadonlySet<string> = new Set(
  POLICY_ENTRIES.filter(([, policy]) => !policy.invoiceOnCancel).map(([status]) => status),
);

// The checkout keys that `createTrialSubscription` copies from the SetupIntent to the subscription.
const CHECKOUT_CONSENT_METADATA_KEYS = [
  SUBSCRIPTION_WITHDRAWAL_METADATA.orderUserId,
  SUBSCRIPTION_WITHDRAWAL_METADATA.consentAt,
  SUBSCRIPTION_WITHDRAWAL_METADATA.consentVersion,
  SUBSCRIPTION_WITHDRAWAL_METADATA.consentLocale,
  SUBSCRIPTION_WITHDRAWAL_METADATA.consentText,
] as const;

/**
 * When the contract started: the payment of the subscription's first invoice. Stripe sets
 * `start_date` when checkout opens, up to 23 hours before the order, so it is only a lower bound.
 */
export function selectContractStart({
  startDate,
  firstInvoicePaidAt,
}: {
  startDate: Date;
  // Null for a trial: its subscription is made after the card is confirmed, so `startDate` is the order.
  firstInvoicePaidAt: Date | null;
}): Date {
  return firstInvoicePaidAt && firstInvoicePaidAt.getTime() > startDate.getTime() ? firstInvoicePaidAt : startDate;
}

/**
 * The last instant a consumer may withdraw: the close of the 14th day after the order day (art. 9),
 * read in the EU time zone that ends it last. The order day is read at UTC+4, its end at UTC-4.
 */
export function selectWithdrawalWindowEnd(startedAt: Date): Date {
  const latestZone = new Date(startedAt.getTime() + WITHDRAWAL_ZONE_OFFSET_MS);
  const orderDay = Date.UTC(latestZone.getUTCFullYear(), latestZone.getUTCMonth(), latestZone.getUTCDate());

  return new Date(orderDay + (WITHDRAWAL_PERIOD_DAYS + 1) * DAY_IN_MS + WITHDRAWAL_ZONE_OFFSET_MS + WITHDRAWAL_WINDOW_GRACE_MS);
}

/** A recorded `withdrawnAt` is always eligible: the withdrawal is done, and only its effects may still be missing. */
export function selectWithdrawalEligibility({
  status,
  startedAt,
  isConsumer,
  withdrawnAt,
  now,
}: {
  status: string | null | undefined;
  startedAt: Date;
  isConsumer: boolean;
  withdrawnAt: Date | null;
  now: Date;
}): WithdrawalEligibility {
  const windowEndsAt = selectWithdrawalWindowEnd(startedAt);
  if (withdrawnAt) {
    return { eligible: true, windowEndsAt, resuming: true };
  }
  if (!getStripeSubscriptionTransitionPolicy(status)?.euWithdrawable) {
    return { eligible: false, reason: "status" };
  }
  if (!isConsumer) {
    return { eligible: false, reason: "not_consumer" };
  }
  if (now.getTime() >= windowEndsAt.getTime()) {
    return { eligible: false, reason: "window_closed" };
  }

  return { eligible: true, windowEndsAt, resuming: false };
}

/** The fields of a Stripe invoice that the refund selector reads. `alreadyCredited` comes from `selectWithdrawalCredits`. */
export function toWithdrawalInvoice({
  invoice,
  alreadyCredited,
}: {
  invoice: Stripe.Invoice;
  alreadyCredited: number;
}): WithdrawalInvoice {
  const paidAt = invoice.status_transitions?.paid_at;

  return {
    invoiceId: invoice.id,
    currency: invoice.currency,
    amountPaid: invoice.amount_paid,
    alreadyCredited,
    paidAt: paidAt ? new Date(paidAt * 1000) : null,
    lines: (invoice.lines?.data ?? []).map((line) => ({
      amount: line.amount,
      periodStart: new Date(line.period.start * 1000),
      periodEnd: new Date(line.period.end * 1000),
    })),
  };
}

/**
 * Without consent the consumer gets back all they paid (art. 14(4)). With consent they pay the
 * days used, then the fork's extra charges, newest invoice first. `refundNow` subtracts our earlier refunds.
 */
export function selectWithdrawalRefund({
  invoices,
  startedAt,
  withdrawnAt,
  consent,
  extraCharges,
}: {
  invoices: readonly WithdrawalInvoice[];
  startedAt: Date;
  withdrawnAt: Date;
  consent: boolean;
  extraCharges: number;
}): WithdrawalRefund {
  const windowEndsAt = selectWithdrawalWindowEnd(startedAt);
  // A renewal paid after the window and before the withdrawal is not part of this contract. One
  // paid after the withdrawal (a late retry of a past_due invoice) is money we must give back.
  const counted = invoices
    .filter(({ paidAt }) => paidAt !== null
      && paidAt.getTime() >= startedAt.getTime()
      && (paidAt.getTime() < windowEndsAt.getTime() || paidAt.getTime() >= withdrawnAt.getTime()))
    .toSorted((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0));

  const usedAmounts = counted.map((invoice) => consent
    ? Math.round(invoice.amountPaid * usedShare({ lines: invoice.lines, startedAt, withdrawnAt }))
    : 0);
  // A proration credit gives back days that an earlier invoice charged. Its negative used amount
  // lowers the used amount of the other invoices, so those days do not count twice.
  let unusedCredit = usedAmounts.reduce((sum, used) => sum + Math.max(0, -used), 0);
  let remainingCharges = Math.max(0, extraCharges);
  const perInvoice = counted.map((invoice, index) => {
    const ownUsed = Math.max(0, usedAmounts[index] ?? 0);
    const offset = Math.min(ownUsed, unusedCredit);
    unusedCredit -= offset;
    const beforeCharges = Math.max(0, invoice.amountPaid - (ownUsed - offset));
    const charged = Math.min(beforeCharges, remainingCharges);
    remainingCharges -= charged;
    const refund = beforeCharges - charged;

    return {
      invoiceId: invoice.invoiceId,
      refund,
      refundNow: Math.max(0, refund - invoice.alreadyCredited),
    };
  });

  const totalPaid = counted.reduce((sum, invoice) => sum + invoice.amountPaid, 0);

  return {
    currency: counted[0]?.currency ?? null,
    totalRefund: perInvoice.reduce((sum, invoice) => sum + invoice.refund, 0),
    kind: totalPaid === 0 ? "none" : consent ? "prorated" : "full",
    perInvoice,
  };
}

/**
 * The refund each invoice already got from this withdrawal. Only our own credit notes count: a
 * goodwill credit note from staff must not lower the refund.
 */
export function selectWithdrawalCredits({
  creditNotes,
  subscriptionId,
}: {
  creditNotes: readonly Stripe.CreditNote[];
  subscriptionId: string;
}): Map<string, number> {
  const credits = new Map<string, number>();
  for (const note of creditNotes) {
    const invoiceId = getStripeId(note.invoice);
    if (note.status === "void" || !invoiceId
      || note.metadata?.[CREDIT_NOTE_WITHDRAWAL_METADATA.subscriptionId] !== subscriptionId) {
      continue;
    }
    credits.set(invoiceId, (credits.get(invoiceId) ?? 0) + note.amount);
  }

  return credits;
}

/**
 * The most that a new credit note may refund on one invoice. Stripe subtracts every earlier
 * post-payment credit note and every direct refund (a refund without a credit note) of the charge.
 */
export function selectInvoiceCreditable({
  amountPaid,
  postPaymentCreditNotesAmount,
  chargeAmountRefunded,
  creditNotes,
}: {
  amountPaid: number;
  postPaymentCreditNotesAmount: number;
  // The sum of `amount_refunded` of the invoice's charges, refunds of credit notes included.
  chargeAmountRefunded: number;
  // Every credit note of the invoice, ours and staff's.
  creditNotes: readonly Stripe.CreditNote[];
}): number {
  const creditNoteRefunded = creditNotes
    .filter(({ status }) => status !== "void")
    .reduce((sum, note) => sum + (note.refunds ?? []).reduce((total, { amount_refunded }) => total + amount_refunded, 0), 0);
  const directRefunds = Math.max(0, chargeAmountRefunded - creditNoteRefunded);

  return Math.max(0, amountPaid - postPaymentCreditNotesAmount - directRefunds);
}

/** The subscription whose withdrawal issued this refund, from our credit note that holds it, or null. */
export function selectRefundWithdrawal({
  creditNotes,
  refundId,
}: {
  creditNotes: readonly Stripe.CreditNote[];
  refundId: string;
}): string | null {
  const note = creditNotes.find((candidate) => (candidate.refunds ?? [])
    .some(({ refund }) => getStripeId(refund) === refundId));

  return note?.metadata?.[CREDIT_NOTE_WITHDRAWAL_METADATA.subscriptionId] || null;
}

/** Why a resume job stops before it does anything, or null when it continues. */
export function selectResumeStop({
  record,
  scheduledFor,
}: {
  record: WithdrawalMetadata;
  scheduledFor: string;
}): "notRecorded" | "superseded" | WithdrawalChainEnd | null {
  // The action saves the job before its claim; when the claim failed, there is nothing to resume.
  if (!record.withdrawnAt) {
    return "notRecorded";
  }
  if (record.resumeAt !== scheduledFor) {
    return "superseded";
  }

  return selectStoredChainEnd(record);
}

/**
 * Whether the chain has ended: every refund is issued, or staff own the refunds, and the receipt
 * is sent (art. 11(3)). The receipt is a legal duty, so without it the chain never ends here.
 */
export function selectChainEnd({
  refunds,
  receiptSent,
}: {
  refunds: WithdrawalRefundsStatus;
  receiptSent: boolean;
}): WithdrawalChainEnd | null {
  if (!receiptSent) {
    return null;
  }
  if (refunds === "done") {
    return "completed";
  }

  return refunds === "needs_staff" ? "needsStaff" : null;
}

/** `selectChainEnd` for the stored record. A record without a mark still owes refunds. */
export function selectStoredChainEnd(record: WithdrawalMetadata): WithdrawalChainEnd | null {
  return selectChainEnd({
    refunds: record.completedAt ? "done" : record.needsStaffAt ? "needs_staff" : "retry",
    receiptSent: record.completedAt !== null || record.receiptSentAt !== null,
  });
}

/**
 * What the resume job does after its steps. Staff or done ends the chain only with a receipt.
 * The chain also ends at the maximum age. `overdue` asks for the art. 13 log line.
 */
export function selectResumeNext({
  status,
  receiptSent,
  withdrawnAt,
  now,
}: {
  status: WithdrawalRefundsStatus;
  receiptSent: boolean;
  withdrawnAt: Date;
  now: Date;
}): { next: WithdrawalChainEnd | "gaveUp" | "reschedule"; overdue: boolean } {
  const end = selectChainEnd({ refunds: status, receiptSent });
  if (end) {
    return { next: end, overdue: false };
  }
  const ageMs = now.getTime() - withdrawnAt.getTime();
  if (ageMs >= RESUME_MAX_AGE_DAYS * DAY_IN_MS) {
    return { next: "gaveUp", overdue: false };
  }

  return { next: "reschedule", overdue: status === "retry" && ageMs >= REFUND_DEADLINE_DAYS * DAY_IN_MS };
}

/**
 * Whether the queue dropped the chain of this withdrawal: it is not complete, the chain still
 * has work, its run time is long past, and it is younger than the maximum age.
 */
export function selectStalledWithdrawal({ record, now }: { record: WithdrawalMetadata; now: Date }): boolean {
  const resumeAt = parseInstant(record.resumeAt);
  if (!record.withdrawnAt || !resumeAt || selectStoredChainEnd(record)) {
    return false;
  }

  return now.getTime() - resumeAt.getTime() >= RESUME_STALL_AFTER_MS
    && now.getTime() - record.withdrawnAt.getTime() < RESUME_MAX_AGE_DAYS * DAY_IN_MS;
}

/** Stripe metadata for the checkout consent. An unticked box writes "" to delete a consent an earlier attempt stored. */
export function buildCheckoutConsentMetadata({
  immediateStart,
  userId,
  at,
  locale,
  text,
}: {
  immediateStart: boolean;
  userId: string;
  at: Date;
  locale: string;
  text: string;
}): Record<string, string> {
  return {
    [SUBSCRIPTION_WITHDRAWAL_METADATA.orderUserId]: userId,
    [SUBSCRIPTION_WITHDRAWAL_METADATA.consentAt]: immediateStart ? at.toISOString() : "",
    [SUBSCRIPTION_WITHDRAWAL_METADATA.consentVersion]: immediateStart ? String(CONSENT_TEXT_VERSION) : "",
    [SUBSCRIPTION_WITHDRAWAL_METADATA.consentLocale]: immediateStart ? locale : "",
    [SUBSCRIPTION_WITHDRAWAL_METADATA.consentText]: immediateStart ? text : "",
  };
}

/** The withdrawal record that Stripe metadata holds. A consent counts only with both its time and its text. */
export function readWithdrawalMetadata(metadata: Record<string, string> | null | undefined): WithdrawalMetadata {
  const read = (key: string) => metadata?.[key] || null;
  const consentAt = parseInstant(read(SUBSCRIPTION_WITHDRAWAL_METADATA.consentAt));
  const consentText = read(SUBSCRIPTION_WITHDRAWAL_METADATA.consentText);

  return {
    orderUserId: read(SUBSCRIPTION_WITHDRAWAL_METADATA.orderUserId),
    consent: consentAt && consentText
      ? {
        at: consentAt,
        version: Number.parseInt(read(SUBSCRIPTION_WITHDRAWAL_METADATA.consentVersion) ?? "", 10) || null,
        locale: read(SUBSCRIPTION_WITHDRAWAL_METADATA.consentLocale),
        text: consentText,
      }
      : null,
    withdrawnAt: parseInstant(read(SUBSCRIPTION_WITHDRAWAL_METADATA.withdrawnAt)),
    withdrawnByUserId: read(SUBSCRIPTION_WITHDRAWAL_METADATA.withdrawnByUserId),
    receiptSentAt: parseInstant(read(SUBSCRIPTION_WITHDRAWAL_METADATA.receiptSentAt)),
    resumeAt: read(SUBSCRIPTION_WITHDRAWAL_METADATA.resumeAt),
    needsStaffAt: parseInstant(read(SUBSCRIPTION_WITHDRAWAL_METADATA.needsStaffAt)),
    completedAt: parseInstant(read(SUBSCRIPTION_WITHDRAWAL_METADATA.completedAt)),
  };
}

/** The non-empty checkout keys, for a create call: "" means "delete" and has nothing to delete there. */
export function pickCheckoutConsentMetadata(metadata: Record<string, string> | null | undefined): Record<string, string> {
  return Object.fromEntries(CHECKOUT_CONSENT_METADATA_KEYS.flatMap((key) => {
    const value = metadata?.[key];
    return value ? [[key, value]] : [];
  }));
}

/** The first time a subscription gives access: the moment the contract starts and the order confirmation goes out. */
export function isFirstActivation({
  previousStatus,
  status,
}: {
  previousStatus: string | null | undefined;
  status: string;
}): boolean {
  return ACTIVATED_STATUSES.has(status) && (!previousStatus || NOT_YET_ORDERED_STATUSES.has(previousStatus));
}

// The share of the paid period the consumer used, weighted by line amount. Use starts at the
// contract start, never before it. A proration credit line weighs in with its negative amount, so
// the share can be negative: the invoice gives back days that an earlier invoice charged.
function usedShare({
  lines,
  startedAt,
  withdrawnAt,
}: {
  lines: readonly WithdrawalInvoiceLine[];
  startedAt: Date;
  withdrawnAt: Date;
}): number {
  const weight = lines.reduce((sum, line) => sum + line.amount, 0);
  if (weight <= 0) {
    return 0;
  }

  return lines.reduce((sum, line) => {
    const periodDays = Math.max(1, Math.ceil((line.periodEnd.getTime() - line.periodStart.getTime()) / DAY_IN_MS));
    const usedFrom = Math.max(line.periodStart.getTime(), startedAt.getTime());
    const usedDays = Math.min(periodDays, Math.max(0, Math.ceil((withdrawnAt.getTime() - usedFrom) / DAY_IN_MS)));
    return sum + (line.amount / weight) * (usedDays / periodDays);
  }, 0);
}

function parseInstant(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// What the refund step left: all issued, a failure to try again, or a case for staff.
type WithdrawalRefundsStatus = "done" | "retry" | "needs_staff";

type WithdrawalChainEnd = "completed" | "needsStaff";

export type WithdrawalEligibility =
  | { eligible: true; windowEndsAt: Date; resuming: boolean }
  | { eligible: false; reason: "status" | "not_consumer" | "window_closed" };

interface WithdrawalInvoiceLine {
  amount: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface WithdrawalInvoice {
  invoiceId: string;
  currency: string;
  amountPaid: number;
  alreadyCredited: number;
  paidAt: Date | null;
  lines: WithdrawalInvoiceLine[];
}

export interface WithdrawalRefund {
  currency: string | null;
  totalRefund: number;
  kind: WithdrawalRefundKind;
  perInvoice: { invoiceId: string; refund: number; refundNow: number }[];
}

export interface WithdrawalMetadata {
  orderUserId: string | null;
  consent: { at: Date; version: number | null; locale: string | null; text: string } | null;
  withdrawnAt: Date | null;
  withdrawnByUserId: string | null;
  receiptSentAt: Date | null;
  // Kept as the stored string: the resume job compares it with its own run time.
  resumeAt: string | null;
  needsStaffAt: Date | null;
  completedAt: Date | null;
}
