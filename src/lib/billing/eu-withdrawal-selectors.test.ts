import type Stripe from "stripe";
import { describe, expect, test } from "vitest";

import { DAY_IN_MS as DAY_MS } from "@/constants";
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
} from "@/constants/eu-withdrawal";
import { STRIPE_SUBSCRIPTION_TRANSITION_POLICY } from "@/constants/subscription-lifecycle";
import {
  buildCheckoutConsentMetadata,
  isFirstActivation,
  pickCheckoutConsentMetadata,
  selectContractStart,
  readWithdrawalMetadata,
  selectChainEnd,
  selectInvoiceCreditable,
  selectRefundWithdrawal,
  selectResumeNext,
  selectResumeStop,
  selectStalledWithdrawal,
  selectStoredChainEnd,
  selectWithdrawalCredits,
  selectWithdrawalEligibility,
  selectWithdrawalRefund,
  selectWithdrawalWindowEnd,
  toWithdrawalInvoice,
  type WithdrawalInvoice,
} from "./eu-withdrawal-selectors";

const HOUR_MS = 60 * 60 * 1000;
// 22:30 UTC on 1 March is already 2 March at UTC+4, so the order day is 2 March.
const STARTED_AT = new Date("2026-03-01T22:30:00.000Z");
const ORDER_DAY_AT_UTC_PLUS_4 = new Date("2026-03-02T00:00:00.000Z");
const WINDOW_END = new Date(ORDER_DAY_AT_UTC_PLUS_4.getTime() + (WITHDRAWAL_PERIOD_DAYS + 1) * DAY_MS
  + WITHDRAWAL_ZONE_OFFSET_MS + WITHDRAWAL_WINDOW_GRACE_MS);
const PERIOD_DAYS = 30;

const WITHDRAWABLE_STATUSES = Object.entries(STRIPE_SUBSCRIPTION_TRANSITION_POLICY)
  .filter(([, policy]) => policy.euWithdrawable)
  .map(([status]) => status);
const NOT_WITHDRAWABLE_STATUSES = Object.entries(STRIPE_SUBSCRIPTION_TRANSITION_POLICY)
  .filter(([, policy]) => !policy.euWithdrawable)
  .map(([status]) => status);

describe("selectContractStart", () => {
  const openedAt = new Date("2026-03-01T05:44:00.000Z");

  // Stripe keeps an incomplete subscription up to 23 hours; the order is the payment.
  test("is the first payment when it came after the dialog opened", () => {
    const paidAt = new Date(openedAt.getTime() + 20 * HOUR_MS);
    expect(selectContractStart({ startDate: openedAt, firstInvoicePaidAt: paidAt })).toEqual(paidAt);
  });

  test("is never earlier than the subscription start", () => {
    const paidAt = new Date(openedAt.getTime() - 1);
    expect(selectContractStart({ startDate: openedAt, firstInvoicePaidAt: paidAt })).toEqual(openedAt);
    expect(selectContractStart({ startDate: openedAt, firstInvoicePaidAt: null })).toEqual(openedAt);
  });

  test("a payment 20 hours after the dialog moves the window end by a day", () => {
    const paidAt = new Date("2026-03-02T01:44:00.000Z");
    const start = selectContractStart({ startDate: openedAt, firstInvoicePaidAt: paidAt });
    expect(selectWithdrawalWindowEnd(start).getTime() - selectWithdrawalWindowEnd(openedAt).getTime()).toBe(DAY_MS);
  });
});

describe("selectWithdrawalWindowEnd", () => {
  test("ends after the 14 days that follow the order day, plus the grace", () => {
    expect(selectWithdrawalWindowEnd(STARTED_AT)).toEqual(WINDOW_END);
  });

  test("gives the same end for any time of the same order day at UTC+4", () => {
    expect(selectWithdrawalWindowEnd(new Date(ORDER_DAY_AT_UTC_PLUS_4.getTime() - WITHDRAWAL_ZONE_OFFSET_MS))).toEqual(WINDOW_END);
    expect(selectWithdrawalWindowEnd(new Date(ORDER_DAY_AT_UTC_PLUS_4.getTime() + DAY_MS - WITHDRAWAL_ZONE_OFFSET_MS - 1)))
      .toEqual(WINDOW_END);
  });

  // Late by some hours is fine. Early is not: the consumer has the full 14 days of their own zone.
  test("never closes before the end of the 14th day after the local order day, from UTC-4 to UTC+4", () => {
    const zoneOffsetsHours = Array.from({ length: 17 }, (__, index) => index / 2 - 4);
    const orderTimes = Array.from({ length: 96 }, (__, index) => new Date(STARTED_AT.getTime() + index * 15 * 60 * 1000));

    for (const orderTime of orderTimes) {
      for (const offsetHours of zoneOffsetsHours) {
        const offsetMs = offsetHours * HOUR_MS;
        const local = new Date(orderTime.getTime() + offsetMs);
        const localOrderDay = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
        const localWindowEnd = localOrderDay + (WITHDRAWAL_PERIOD_DAYS + 1) * DAY_MS - offsetMs;

        expect(selectWithdrawalWindowEnd(orderTime).getTime()).toBeGreaterThanOrEqual(localWindowEnd);
      }
    }
  });
});

describe("selectWithdrawalEligibility", () => {
  const base = { startedAt: STARTED_AT, isConsumer: true, withdrawnAt: null, now: STARTED_AT };

  test("withdrawable statuses are exactly the ones that ran", () => {
    expect(WITHDRAWABLE_STATUSES.sort()).toEqual(["active", "past_due", "trialing"]);
  });

  test.each(WITHDRAWABLE_STATUSES)("a consumer in the window may withdraw a %s subscription", (status) => {
    expect(selectWithdrawalEligibility({ ...base, status })).toEqual({ eligible: true, windowEndsAt: WINDOW_END, resuming: false });
  });

  test.each([...NOT_WITHDRAWABLE_STATUSES, null, "unknown"])("refuses the status %s", (status) => {
    expect(selectWithdrawalEligibility({ ...base, status })).toEqual({ eligible: false, reason: "status" });
  });

  test("refuses a business customer", () => {
    expect(selectWithdrawalEligibility({ ...base, status: "active", isConsumer: false }))
      .toEqual({ eligible: false, reason: "not_consumer" });
  });

  test("closes the window at its end, not one moment before", () => {
    const before = new Date(WINDOW_END.getTime() - 1);
    expect(selectWithdrawalEligibility({ ...base, status: "active", now: before }).eligible).toBe(true);
    expect(selectWithdrawalEligibility({ ...base, status: "active", now: WINDOW_END }))
      .toEqual({ eligible: false, reason: "window_closed" });
  });

  // The withdrawal already happened: only its effects (cancel, refund) may be missing.
  test("a recorded withdrawal resumes after the cancel and after the window", () => {
    const withdrawnAt = new Date(STARTED_AT.getTime() + DAY_MS);
    const late = new Date(WINDOW_END.getTime() + 30 * DAY_MS);
    expect(selectWithdrawalEligibility({ ...base, status: "canceled", isConsumer: false, withdrawnAt, now: late }))
      .toEqual({ eligible: true, windowEndsAt: WINDOW_END, resuming: true });
  });
});

describe("selectWithdrawalRefund", () => {
  const withdrawnAt = new Date(STARTED_AT.getTime() + 3 * DAY_MS);

  test("refunds everything without consent", () => {
    const refund = selectWithdrawalRefund({
      invoices: [invoice({ invoiceId: "in_1", amountPaid: 3000 })],
      startedAt: STARTED_AT,
      withdrawnAt,
      consent: false,
      extraCharges: 0,
    });

    expect(refund).toEqual({
      currency: "eur",
      totalRefund: 3000,
      kind: "full",
      perInvoice: [{ invoiceId: "in_1", refund: 3000, refundNow: 3000 }],
    });
  });

  test("keeps the used days with consent", () => {
    const refund = selectWithdrawalRefund({
      invoices: [invoice({ invoiceId: "in_1", amountPaid: 3000 })],
      startedAt: STARTED_AT,
      withdrawnAt,
      consent: true,
      extraCharges: 0,
    });

    expect(refund.kind).toBe("prorated");
    expect(refund.totalRefund).toBe(3000 - Math.round(3000 * (3 / PERIOD_DAYS)));
  });

  test("counts a started day as used", () => {
    const refund = selectWithdrawalRefund({
      invoices: [invoice({ invoiceId: "in_1", amountPaid: 3000 })],
      startedAt: STARTED_AT,
      withdrawnAt: new Date(STARTED_AT.getTime() + 1),
      consent: true,
      extraCharges: 0,
    });

    expect(refund.totalRefund).toBe(3000 - Math.round(3000 / PERIOD_DAYS));
  });

  // The line period starts when Stripe made the subscription; the consumer used nothing before the order.
  test("counts no used day before the contract start", () => {
    const lineStart = new Date(STARTED_AT.getTime() - 20 * HOUR_MS);
    const refund = selectWithdrawalRefund({
      invoices: [invoice({
        invoiceId: "in_1",
        amountPaid: 3000,
        lines: [{ amount: 3000, periodStart: lineStart, periodEnd: new Date(lineStart.getTime() + PERIOD_DAYS * DAY_MS) }],
      })],
      startedAt: STARTED_AT,
      withdrawnAt: new Date(STARTED_AT.getTime() + 5 * HOUR_MS),
      consent: true,
      extraCharges: 0,
    });

    expect(refund.totalRefund).toBe(3000 - Math.round(3000 / PERIOD_DAYS));
  });

  test("weights the used share by line amount", () => {
    // An add-on line that started a day after the contract.
    const shortStart = new Date(STARTED_AT.getTime() + DAY_MS);
    const refund = selectWithdrawalRefund({
      invoices: [invoice({
        invoiceId: "in_1",
        amountPaid: 2500,
        lines: [
          { amount: 1500, periodStart: STARTED_AT, periodEnd: new Date(STARTED_AT.getTime() + PERIOD_DAYS * DAY_MS) },
          { amount: 1000, periodStart: shortStart, periodEnd: new Date(shortStart.getTime() + 10 * DAY_MS) },
        ],
      })],
      startedAt: STARTED_AT,
      withdrawnAt,
      consent: true,
      extraCharges: 0,
    });
    const share = (1500 / 2500) * (3 / PERIOD_DAYS) + (1000 / 2500) * (2 / 10);

    expect(refund.totalRefund).toBe(2500 - Math.round(2500 * share));
  });

  // Monthly on day 0, then yearly on day 1 with a credit for the unused monthly days. The days
  // after the change are in the yearly line, so the credit line gives them back from the monthly invoice.
  test("counts the days after an interval change once", () => {
    const changedAt = new Date(STARTED_AT.getTime() + DAY_MS);
    const monthEnd = new Date(STARTED_AT.getTime() + PERIOD_DAYS * DAY_MS);
    const refund = selectWithdrawalRefund({
      invoices: [
        invoice({ invoiceId: "in_month", amountPaid: 3000, paidAt: STARTED_AT }),
        invoice({
          invoiceId: "in_year",
          amountPaid: 27100,
          paidAt: changedAt,
          lines: [
            { amount: 30000, periodStart: changedAt, periodEnd: new Date(changedAt.getTime() + 365 * DAY_MS) },
            { amount: -2900, periodStart: changedAt, periodEnd: monthEnd },
          ],
        }),
      ],
      startedAt: STARTED_AT,
      withdrawnAt: new Date(STARTED_AT.getTime() + 13 * DAY_MS),
      consent: true,
      extraCharges: 0,
    });
    const usedMonthly = Math.round(3000 * (13 / PERIOD_DAYS));
    const usedYearlyNet = Math.round(30000 * (12 / 365) - 2900 * (12 / 29));

    expect(3000 + 27100 - refund.totalRefund).toBe(usedMonthly + usedYearlyNet);
    expect(refund.perInvoice).toEqual([
      { invoiceId: "in_year", refund: 27100, refundNow: 27100 },
      { invoiceId: "in_month", refund: 3000 - (usedMonthly + usedYearlyNet), refundNow: 3000 - (usedMonthly + usedYearlyNet) },
    ]);
  });

  test("takes the extra charges from the newest invoice first and never goes below zero", () => {
    const refund = selectWithdrawalRefund({
      invoices: [
        invoice({ invoiceId: "in_old", amountPaid: 1000, paidAt: STARTED_AT }),
        invoice({ invoiceId: "in_new", amountPaid: 500, paidAt: new Date(withdrawnAt.getTime() + DAY_MS) }),
      ],
      startedAt: STARTED_AT,
      withdrawnAt,
      consent: false,
      extraCharges: 700,
    });

    expect(refund.perInvoice).toEqual([
      { invoiceId: "in_new", refund: 0, refundNow: 0 },
      { invoiceId: "in_old", refund: 800, refundNow: 800 },
    ]);
    expect(refund.totalRefund).toBe(800);
  });

  test("subtracts credit notes already issued from what to refund now", () => {
    const refund = selectWithdrawalRefund({
      invoices: [invoice({ invoiceId: "in_1", amountPaid: 3000, alreadyCredited: 1000 })],
      startedAt: STARTED_AT,
      withdrawnAt,
      consent: false,
      extraCharges: 0,
    });

    expect(refund.perInvoice).toEqual([{ invoiceId: "in_1", refund: 3000, refundNow: 2000 }]);
  });

  test("skips a renewal paid after the window and before the withdrawal, and keeps one paid after the withdrawal", () => {
    const lateWithdrawal = new Date(WINDOW_END.getTime() + 10 * DAY_MS);
    const refund = selectWithdrawalRefund({
      invoices: [
        invoice({ invoiceId: "in_first", amountPaid: 1000, paidAt: STARTED_AT }),
        invoice({ invoiceId: "in_renewal", amountPaid: 1000, paidAt: new Date(WINDOW_END.getTime() + DAY_MS) }),
        invoice({ invoiceId: "in_retry", amountPaid: 1000, paidAt: new Date(lateWithdrawal.getTime() + DAY_MS) }),
        invoice({ invoiceId: "in_before", amountPaid: 1000, paidAt: new Date(STARTED_AT.getTime() - DAY_MS) }),
        invoice({ invoiceId: "in_unpaid", amountPaid: 0, paidAt: null }),
      ],
      startedAt: STARTED_AT,
      withdrawnAt: lateWithdrawal,
      consent: false,
      extraCharges: 0,
    });

    expect(refund.perInvoice.map(({ invoiceId }) => invoiceId)).toEqual(["in_retry", "in_first"]);
  });

  test("reports nothing to refund when nothing was paid", () => {
    expect(selectWithdrawalRefund({ invoices: [], startedAt: STARTED_AT, withdrawnAt, consent: true, extraCharges: 0 }))
      .toEqual({ currency: null, totalRefund: 0, kind: "none", perInvoice: [] });
  });
});

describe("toWithdrawalInvoice", () => {
  test("reads the paid amount, the credited amount, the paid time, and the line periods", () => {
    const stripeInvoice = {
      id: "in_1",
      currency: "eur",
      amount_paid: 3000,
      post_payment_credit_notes_amount: 500,
      status_transitions: { paid_at: 1_772_000_000 },
      lines: { data: [{ amount: 3000, period: { start: 1_772_000_000, end: 1_774_592_000 } }] },
    } as unknown as Stripe.Invoice;

    expect(toWithdrawalInvoice({ invoice: stripeInvoice, alreadyCredited: 500 })).toEqual({
      invoiceId: "in_1",
      currency: "eur",
      amountPaid: 3000,
      alreadyCredited: 500,
      paidAt: new Date(1_772_000_000 * 1000),
      lines: [{ amount: 3000, periodStart: new Date(1_772_000_000 * 1000), periodEnd: new Date(1_774_592_000 * 1000) }],
    });
  });
});

describe("selectWithdrawalCredits", () => {
  const ours = { [CREDIT_NOTE_WITHDRAWAL_METADATA.subscriptionId]: "sub_1" };

  // A goodwill credit note from staff must not lower the cash refund of the withdrawal.
  test("counts only the issued credit notes of this withdrawal, per invoice", () => {
    const credits = selectWithdrawalCredits({
      subscriptionId: "sub_1",
      creditNotes: [
        creditNote({ invoice: "in_1", amount: 1000, metadata: ours }),
        creditNote({ invoice: { id: "in_1" }, amount: 500, metadata: ours }),
        creditNote({ invoice: "in_1", amount: 700, metadata: {} }),
        creditNote({ invoice: "in_1", amount: 300, metadata: ours, status: "void" }),
        creditNote({ invoice: "in_2", amount: 900, metadata: { [CREDIT_NOTE_WITHDRAWAL_METADATA.subscriptionId]: "sub_other" } }),
      ],
    });

    expect([...credits]).toEqual([["in_1", 1500]]);
  });
});

describe("selectInvoiceCreditable", () => {
  test("subtracts every earlier credit note and every direct refund", () => {
    expect(selectInvoiceCreditable({
      amountPaid: 3000,
      postPaymentCreditNotesAmount: 1000,
      chargeAmountRefunded: 500,
      creditNotes: [creditNote({ amount: 1000, refunds: [] })],
    })).toBe(1500);
  });

  // The charge also counts the refunds of credit notes. Those are in the credit note sum already.
  test("does not count the refund of a credit note twice", () => {
    expect(selectInvoiceCreditable({
      amountPaid: 3000,
      postPaymentCreditNotesAmount: 400,
      chargeAmountRefunded: 400,
      creditNotes: [
        creditNote({ amount: 400, refunds: [{ amount_refunded: 400, refund: "re_1" }] }),
        creditNote({ amount: 900, status: "void", refunds: [{ amount_refunded: 900, refund: "re_void" }] }),
      ],
    })).toBe(2600);
  });

  test("is never below zero", () => {
    expect(selectInvoiceCreditable({ amountPaid: 1000, postPaymentCreditNotesAmount: 1000, chargeAmountRefunded: 300, creditNotes: [] })).toBe(0);
  });
});

describe("selectRefundWithdrawal", () => {
  const ours = { [CREDIT_NOTE_WITHDRAWAL_METADATA.subscriptionId]: "sub_1" };

  test("names the subscription of our credit note that holds the refund", () => {
    expect(selectRefundWithdrawal({
      refundId: "re_2",
      creditNotes: [
        creditNote({ metadata: ours, refunds: [{ amount_refunded: 100, refund: "re_1" }] }),
        creditNote({ metadata: ours, refunds: [{ amount_refunded: 100, refund: { id: "re_2" } }] }),
      ],
    })).toBe("sub_1");
  });

  test("is null for a staff credit note or an unknown refund", () => {
    const staffNote = creditNote({ metadata: {}, refunds: [{ amount_refunded: 100, refund: "re_staff" }] });

    expect(selectRefundWithdrawal({ refundId: "re_staff", creditNotes: [staffNote] })).toBeNull();
    expect(selectRefundWithdrawal({ refundId: "re_other", creditNotes: [staffNote] })).toBeNull();
  });
});

describe("selectResumeStop", () => {
  const runAt = "2026-03-04T10:00:00.000Z";
  const recordOf = (extra: Record<string, string>) => readWithdrawalMetadata({
    [SUBSCRIPTION_WITHDRAWAL_METADATA.withdrawnAt]: STARTED_AT.toISOString(),
    [SUBSCRIPTION_WITHDRAWAL_METADATA.resumeAt]: runAt,
    ...extra,
  });

  test.each([
    ["no withdrawal", readWithdrawalMetadata({}), "notRecorded"],
    ["another run time", recordOf({ [SUBSCRIPTION_WITHDRAWAL_METADATA.resumeAt]: "2026-03-04T11:00:00.000Z" }), "superseded"],
    ["staff marked and the receipt sent", recordOf({
      [SUBSCRIPTION_WITHDRAWAL_METADATA.needsStaffAt]: runAt,
      [SUBSCRIPTION_WITHDRAWAL_METADATA.receiptSentAt]: runAt,
    }), "needsStaff"],
    ["staff marked and no receipt", recordOf({ [SUBSCRIPTION_WITHDRAWAL_METADATA.needsStaffAt]: runAt }), null],
    ["the withdrawal is complete", recordOf({ [SUBSCRIPTION_WITHDRAWAL_METADATA.completedAt]: runAt }), "completed"],
    ["the job that owns the chain", recordOf({}), null],
  ])("%s: %s", (__case, record, expected) => {
    expect(selectResumeStop({ record, scheduledFor: runAt })).toBe(expected);
  });
});

// One rule for a run's result and for the stored record, so the job, the action, and the scan agree.
describe("selectChainEnd", () => {
  test.each([
    ["done", true, "completed"],
    ["needs_staff", true, "needsStaff"],
    ["retry", true, null],
    // The receipt is a legal duty, so a missing one never ends the chain.
    ["done", false, null],
    ["needs_staff", false, null],
    ["retry", false, null],
  ] as const)("refunds %s, receipt sent %s: %s", (refunds, receiptSent, expected) => {
    expect(selectChainEnd({ refunds, receiptSent })).toBe(expected);
  });

  const at = STARTED_AT.toISOString();
  test.each([
    ["no mark", {}, null],
    ["only the receipt", { [SUBSCRIPTION_WITHDRAWAL_METADATA.receiptSentAt]: at }, null],
    ["staff marked without a receipt", { [SUBSCRIPTION_WITHDRAWAL_METADATA.needsStaffAt]: at }, null],
    ["staff marked with a receipt", {
      [SUBSCRIPTION_WITHDRAWAL_METADATA.needsStaffAt]: at,
      [SUBSCRIPTION_WITHDRAWAL_METADATA.receiptSentAt]: at,
    }, "needsStaff"],
    ["complete", { [SUBSCRIPTION_WITHDRAWAL_METADATA.completedAt]: at }, "completed"],
    // A failed card refund is for staff, but the chain still owes the other refunds.
    ["a failed refund with a receipt", {
      [SUBSCRIPTION_WITHDRAWAL_METADATA.refundFailedAt]: at,
      [SUBSCRIPTION_WITHDRAWAL_METADATA.receiptSentAt]: at,
    }, null],
  ])("stored record, %s: %s", (__case, metadata, expected) => {
    expect(selectStoredChainEnd(readWithdrawalMetadata(metadata))).toBe(expected);
  });
});

describe("selectResumeNext", () => {
  const withdrawnAt = STARTED_AT;
  const after = (days: number) => new Date(withdrawnAt.getTime() + days * DAY_MS);

  test.each([
    ["done", true, 1, { next: "completed", overdue: false }],
    ["needs_staff", true, 1, { next: "needsStaff", overdue: false }],
    // The receipt is a legal duty, so a missing one keeps the chain going.
    ["needs_staff", false, 1, { next: "reschedule", overdue: false }],
    ["done", false, REFUND_DEADLINE_DAYS, { next: "reschedule", overdue: false }],
    ["retry", true, 1, { next: "reschedule", overdue: false }],
    ["retry", true, REFUND_DEADLINE_DAYS, { next: "reschedule", overdue: true }],
    ["needs_staff", false, RESUME_MAX_AGE_DAYS, { next: "gaveUp", overdue: false }],
    ["retry", true, RESUME_MAX_AGE_DAYS, { next: "gaveUp", overdue: false }],
  ] as const)("%s, receipt sent %s, day %s", (status, receiptSent, day, expected) => {
    expect(selectResumeNext({ status, receiptSent, withdrawnAt, now: after(day) })).toEqual(expected);
  });
});

describe("selectStalledWithdrawal", () => {
  const resumeAt = new Date(STARTED_AT.getTime() + 2 * DAY_MS);
  const now = new Date(resumeAt.getTime() + RESUME_STALL_AFTER_MS);
  const recordOf = (extra: Record<string, string>) => readWithdrawalMetadata({
    [SUBSCRIPTION_WITHDRAWAL_METADATA.withdrawnAt]: STARTED_AT.toISOString(),
    [SUBSCRIPTION_WITHDRAWAL_METADATA.resumeAt]: resumeAt.toISOString(),
    ...extra,
  });

  test("finds a chain whose run time is long past", () => {
    expect(selectStalledWithdrawal({ record: recordOf({}), now })).toBe(true);
    expect(selectStalledWithdrawal({
      record: recordOf({ [SUBSCRIPTION_WITHDRAWAL_METADATA.receiptSentAt]: STARTED_AT.toISOString() }),
      now,
    })).toBe(true);
  });

  // The receipt is still the chain's job after staff take over the refund.
  test("finds a chain marked for staff that still owes the receipt", () => {
    expect(selectStalledWithdrawal({
      record: recordOf({ [SUBSCRIPTION_WITHDRAWAL_METADATA.needsStaffAt]: STARTED_AT.toISOString() }),
      now,
    })).toBe(true);
  });

  test.each([
    ["a live chain", recordOf({}), new Date(now.getTime() - 1)],
    ["a complete withdrawal", recordOf({ [SUBSCRIPTION_WITHDRAWAL_METADATA.completedAt]: now.toISOString() }), now],
    ["a staff case with a receipt", recordOf({
      [SUBSCRIPTION_WITHDRAWAL_METADATA.needsStaffAt]: now.toISOString(),
      [SUBSCRIPTION_WITHDRAWAL_METADATA.receiptSentAt]: now.toISOString(),
    }), now],
    ["a withdrawal past the maximum age", recordOf({}), new Date(STARTED_AT.getTime() + RESUME_MAX_AGE_DAYS * DAY_MS)],
    ["no withdrawal", readWithdrawalMetadata({}), now],
  ])("skips %s", (__case, record, at) => {
    expect(selectStalledWithdrawal({ record, now: at })).toBe(false);
  });
});

describe("checkout consent metadata", () => {
  const at = new Date("2026-03-01T10:00:00.000Z");

  test("a ticked box records the consent with its text, version, and locale", () => {
    const metadata = buildCheckoutConsentMetadata({ immediateStart: true, userId: "usr_1", at, locale: "es", text: "Consent" });

    expect(readWithdrawalMetadata(metadata)).toEqual({
      orderUserId: "usr_1",
      consent: { at, version: CONSENT_TEXT_VERSION, locale: "es", text: "Consent" },
      withdrawnAt: null,
      withdrawnByUserId: null,
      receiptSentAt: null,
      resumeAt: null,
      needsStaffAt: null,
      completedAt: null,
    });
    expect(pickCheckoutConsentMetadata(metadata)).toEqual(metadata);
  });

  // Stripe deletes a metadata key set to "", so a second attempt without the tick clears the first.
  test("an unticked box clears every consent key and keeps the ordering user", () => {
    const metadata = buildCheckoutConsentMetadata({ immediateStart: false, userId: "usr_1", at, locale: "es", text: "Consent" });

    expect(metadata).toEqual({
      [SUBSCRIPTION_WITHDRAWAL_METADATA.orderUserId]: "usr_1",
      [SUBSCRIPTION_WITHDRAWAL_METADATA.consentAt]: "",
      [SUBSCRIPTION_WITHDRAWAL_METADATA.consentVersion]: "",
      [SUBSCRIPTION_WITHDRAWAL_METADATA.consentLocale]: "",
      [SUBSCRIPTION_WITHDRAWAL_METADATA.consentText]: "",
    });
    expect(readWithdrawalMetadata(metadata).consent).toBeNull();
    expect(pickCheckoutConsentMetadata(metadata)).toEqual({ [SUBSCRIPTION_WITHDRAWAL_METADATA.orderUserId]: "usr_1" });
  });

  test("picks only the checkout keys", () => {
    expect(pickCheckoutConsentMetadata({ teamId: "team_1", planId: "pro", [SUBSCRIPTION_WITHDRAWAL_METADATA.withdrawnAt]: at.toISOString() }))
      .toEqual({});
  });

  test("reads a recorded withdrawal and ignores a malformed time", () => {
    expect(readWithdrawalMetadata({
      [SUBSCRIPTION_WITHDRAWAL_METADATA.withdrawnAt]: at.toISOString(),
      [SUBSCRIPTION_WITHDRAWAL_METADATA.withdrawnByUserId]: "usr_2",
      [SUBSCRIPTION_WITHDRAWAL_METADATA.consentAt]: "not a date",
      [SUBSCRIPTION_WITHDRAWAL_METADATA.consentText]: "Consent",
      [SUBSCRIPTION_WITHDRAWAL_METADATA.receiptSentAt]: at.toISOString(),
      [SUBSCRIPTION_WITHDRAWAL_METADATA.resumeAt]: at.toISOString(),
      [SUBSCRIPTION_WITHDRAWAL_METADATA.needsStaffAt]: at.toISOString(),
      [SUBSCRIPTION_WITHDRAWAL_METADATA.completedAt]: at.toISOString(),
    })).toEqual({
      orderUserId: null,
      consent: null,
      withdrawnAt: at,
      withdrawnByUserId: "usr_2",
      receiptSentAt: at,
      resumeAt: at.toISOString(),
      needsStaffAt: at,
      completedAt: at,
    });
    expect(readWithdrawalMetadata(null).withdrawnAt).toBeNull();
  });
});

describe("isFirstActivation", () => {
  test.each([
    [null, "active", true],
    [null, "trialing", true],
    ["incomplete", "active", true],
    ["incomplete_expired", "active", true],
    ["canceled", "trialing", true],
    ["trialing", "active", false],
    ["active", "active", false],
    ["past_due", "active", false],
    [null, "incomplete", false],
    [null, "past_due", false],
    ["unpaid", "active", false],
    ["paused", "active", false],
  ] as const)("%s to %s: %s", (previousStatus, status, expected) => {
    expect(isFirstActivation({ previousStatus, status })).toBe(expected);
  });
});

function invoice(overrides: Partial<WithdrawalInvoice> & Pick<WithdrawalInvoice, "invoiceId" | "amountPaid">): WithdrawalInvoice {
  return {
    currency: "eur",
    alreadyCredited: 0,
    paidAt: STARTED_AT,
    lines: [{ amount: overrides.amountPaid, periodStart: STARTED_AT, periodEnd: new Date(STARTED_AT.getTime() + PERIOD_DAYS * DAY_MS) }],
    ...overrides,
  };
}

function creditNote(fields: Record<string, unknown>): Stripe.CreditNote {
  return { object: "credit_note", status: "issued", ...fields } as unknown as Stripe.CreditNote;
}
