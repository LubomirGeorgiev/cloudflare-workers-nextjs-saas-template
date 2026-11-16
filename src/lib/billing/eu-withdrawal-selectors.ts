import type Stripe from "stripe";

import { DAY_IN_MS } from "@/constants";
import {
  CONSENT_TEXT_VERSION,
  CREDIT_NOTE_WITHDRAWAL_METADATA,
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

  let remainingCharges = Math.max(0, extraCharges);
  const perInvoice = counted.map((invoice) => {
    const used = consent ? Math.round(invoice.amountPaid * usedShare({ lines: invoice.lines, startedAt, withdrawnAt })) : 0;
    const beforeCharges = Math.max(0, invoice.amountPaid - used);
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
// contract start, never before it. Credit lines carry no period of service, so they do not weigh in.
function usedShare({
  lines,
  startedAt,
  withdrawnAt,
}: {
  lines: readonly WithdrawalInvoiceLine[];
  startedAt: Date;
  withdrawnAt: Date;
}): number {
  const charged = lines.filter((line) => line.amount > 0);
  const weight = charged.reduce((sum, line) => sum + line.amount, 0);
  if (weight === 0) {
    return 0;
  }

  return charged.reduce((sum, line) => {
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
}
