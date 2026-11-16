import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { DAY_IN_MS } from "@/constants";
import { DEFAULT_LOCALE } from "@/i18n/config";
import {
  CREDIT_NOTE_WITHDRAWAL_METADATA,
  REFUND_DEADLINE_DAYS,
  SUBSCRIPTION_WITHDRAWAL_METADATA,
} from "@/constants/eu-withdrawal";
import { WITHDRAWAL_CANCEL_PARAMS } from "@/constants/subscription-lifecycle";
import { ActionError } from "@/lib/action-error";
import {
  selectWithdrawalRefund,
  selectWithdrawalWindowEnd,
  toWithdrawalInvoice,
} from "@/lib/billing/eu-withdrawal-selectors";

const {
  enqueueResumeMock,
  findTeamMock,
  findUserMock,
  getStripeMock,
  getTeamSubscriptionMock,
  reconcileMock,
  sendReceiptMock,
} = vi.hoisted(() => ({
  enqueueResumeMock: vi.fn(),
  findTeamMock: vi.fn(),
  findUserMock: vi.fn(),
  getStripeMock: vi.fn(),
  getTeamSubscriptionMock: vi.fn(),
  reconcileMock: vi.fn(async () => "team-1"),
  sendReceiptMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/stripe", () => ({ getStripe: getStripeMock }));
vi.mock("@/lib/scheduler/enqueue", () => ({ enqueueEuWithdrawalResume: enqueueResumeMock }));
vi.mock("@/utils/email", () => ({ sendWithdrawalReceiptEmail: sendReceiptMock }));
vi.mock("@/db", () => ({
  getDB: () => ({ query: { teamTable: { findFirst: findTeamMock }, userTable: { findFirst: findUserMock } } }),
}));
vi.mock("@/utils/team-subscription", () => ({
  getTeamSubscription: getTeamSubscriptionMock,
  reconcileTeamFromSubscription: reconcileMock,
}));

const { getWithdrawalOffer, resumeWithdrawal, withdrawalSignerName, withdrawFromContract } = await import("./eu-withdrawal");

const STARTED_AT = new Date("2026-03-01T09:30:00.000Z");
const NOW = new Date(STARTED_AT.getTime() + 3 * DAY_IN_MS + 123);
const PERIOD_END = new Date(STARTED_AT.getTime() + 30 * DAY_IN_MS);
const SUBSCRIPTION_ID = "sub_eu";
const CUSTOMER_ID = "cus_1";
const TEAM = { id: "team-1", name: "Acme", subscriptionPlanId: null };
const ACTING_USER = { id: "user-1", name: "Ana Ruiz", email: "ana@example.com", locale: DEFAULT_LOCALE };
const M = SUBSCRIPTION_WITHDRAWAL_METADATA;

let calls: { method: string; args: unknown[] }[] = [];
let subscription: Stripe.Subscription;
let invoices: Stripe.Invoice[];
let pendingItems: Stripe.InvoiceItem[];
let creditNotes: Stripe.CreditNote[];
let failures: Map<string, Error>;
// A lost response: Stripe applies the write, and the caller sees a failure.
let lostResponse: string | null;

const fakeStripe = {
  subscriptions: {
    retrieve: vi.fn(async (...args: unknown[]) => record({ method: "subscriptions.retrieve", args, result: () => subscription })),
    update: vi.fn(async (...args: unknown[]) => record({
      method: "subscriptions.update",
      args,
      result: () => {
        const params = args[1] as { metadata: Record<string, string> };
        subscription = { ...subscription, metadata: { ...subscription.metadata, ...params.metadata } };
        return subscription;
      },
    })),
    cancel: vi.fn(async (...args: unknown[]) => record({
      method: "subscriptions.cancel",
      args,
      result: () => {
        subscription = { ...subscription, status: "canceled" };
        return subscription;
      },
    })),
  },
  invoices: {
    list: vi.fn(async (...args: unknown[]) => record({ method: "invoices.list", args, result: () => ({ data: invoices }) })),
    retrieve: vi.fn(async (...args: unknown[]) => record({ method: "invoices.retrieve", args, result: () => invoices[0] })),
    listLineItems: vi.fn(async (...args: unknown[]) => record({
      method: "invoices.listLineItems",
      args,
      result: () => ({ data: [line({ id: "il_2", amount: 500 })], has_more: false }),
    })),
    voidInvoice: vi.fn(async (...args: unknown[]) => record({ method: "invoices.voidInvoice", args, result: () => ({}) as Stripe.Invoice })),
    del: vi.fn(async (...args: unknown[]) => record({ method: "invoices.del", args, result: () => ({}) as Stripe.DeletedInvoice })),
  },
  invoiceItems: {
    list: vi.fn(async (...args: unknown[]) => record({ method: "invoiceItems.list", args, result: () => ({ data: pendingItems }) })),
    del: vi.fn(async (...args: unknown[]) => record({ method: "invoiceItems.del", args, result: () => ({}) as Stripe.DeletedInvoiceItem })),
  },
  creditNotes: {
    create: vi.fn(async (...args: unknown[]) => record({
      method: "creditNotes.create",
      args,
      result: () => {
        const params = args[0] as Stripe.CreditNoteCreateParams;
        const note = { invoice: params.invoice, amount: params.amount, status: "issued", metadata: params.metadata } as unknown as Stripe.CreditNote;
        creditNotes.push(note);
        return note;
      },
    })),
    list: vi.fn(async (...args: unknown[]) => record({
      method: "creditNotes.list",
      args,
      result: () => ({ data: creditNotes.filter((note) => note.invoice === (args[0] as { invoice: string }).invoice) }),
    })),
  },
};

beforeEach(() => {
  calls = [];
  failures = new Map();
  lostResponse = null;
  subscription = makeSubscription({});
  invoices = [makeInvoice({ id: "in_1", amountPaid: 3000 })];
  pendingItems = [];
  creditNotes = [];
  getStripeMock.mockResolvedValue(fakeStripe);
  enqueueResumeMock.mockImplementation(async (params: unknown) => {
    calls.push({ method: "enqueue", args: [params] });
  });
  sendReceiptMock.mockImplementation(async (params: unknown) => {
    calls.push({ method: "receipt", args: [params] });
  });
  findUserMock.mockResolvedValue({ id: ACTING_USER.id, email: ACTING_USER.email, firstName: "Ana", lastName: "Ruiz", preferredLocale: null });
  findTeamMock.mockResolvedValue(TEAM);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("withdrawFromContract", () => {
  // The job is saved before the claim, so a lost claim response still gets its cancel and refund.
  // The receipt goes out before the cancel, so a Stripe failure after the claim cannot delay it.
  test("saves the resume job, claims, sends the receipt, cancels, clears, and refunds in that order", async () => {
    invoices = [
      makeInvoice({ id: "in_1", amountPaid: 3000 }),
      makeInvoice({ id: "in_open", status: "open", amountPaid: 0 }),
      makeInvoice({ id: "in_draft", status: "draft", amountPaid: 0 }),
    ];
    pendingItems = [pendingItem({ id: "ii_ours", subscriptionId: SUBSCRIPTION_ID }), pendingItem({ id: "ii_other", subscriptionId: "sub_other" })];

    await expect(withdraw()).resolves.toEqual({ completed: true });

    expect(methods()).toEqual([
      "subscriptions.retrieve",
      "invoices.list",
      "enqueue",
      "subscriptions.update",
      "receipt",
      "subscriptions.update",
      "subscriptions.cancel",
      "invoices.list",
      "invoices.voidInvoice",
      "invoices.del",
      "invoiceItems.list",
      "invoiceItems.del",
      "creditNotes.list",
      "creditNotes.create",
    ]);
    expect(argsOf("subscriptions.retrieve")).toEqual([SUBSCRIPTION_ID, {
      expand: ["customer.tax_ids", "customer.invoice_settings.default_payment_method", "default_payment_method", "latest_invoice"],
    }]);
    expect(argsOf("invoices.voidInvoice")).toEqual(["in_open", {}, { idempotencyKey: "eu-withdrawal-void:in_open" }]);
    expect(argsOf("invoices.del")).toEqual(["in_draft"]);
    expect(argsOf("invoiceItems.list")).toEqual([expect.objectContaining({ customer: CUSTOMER_ID, pending: true })]);
    expect(argsOf("invoiceItems.del")).toEqual(["ii_ours"]);
    expect(argsOf("subscriptions.cancel")).toEqual([
      SUBSCRIPTION_ID,
      { ...WITHDRAWAL_CANCEL_PARAMS, cancellation_details: { comment: expect.any(String) } },
      { idempotencyKey: `eu-withdrawal-cancel:${SUBSCRIPTION_ID}` },
    ]);
    // No consent: the consumer gets back all they paid.
    expect(argsOf("creditNotes.create")).toEqual([
      {
        invoice: "in_1",
        amount: 3000,
        refund_amount: 3000,
        metadata: { [CREDIT_NOTE_WITHDRAWAL_METADATA.subscriptionId]: SUBSCRIPTION_ID },
      },
      { idempotencyKey: "eu-withdrawal-refund:in_1" },
    ]);
    expect(sendReceiptMock).toHaveBeenCalledWith(expect.objectContaining({
      email: ACTING_USER.email,
      name: ACTING_USER.name,
      teamName: TEAM.name,
      startedAt: STARTED_AT,
      withdrawnAt: NOW,
      refund: { kind: "full", amount: 3000, currency: "eur" },
      locale: ACTING_USER.locale,
    }));
    expect(subscription.metadata[M.receiptSentAt]).toEqual(expect.any(String));
    expect(reconcileMock).toHaveBeenCalledWith({ subscription: expect.objectContaining({ status: "canceled" }) });
  });

  test("the claim names the saved job's run time, in whole seconds", async () => {
    await withdraw();

    const [{ runAt }] = argsOf("enqueue") as [{ runAt: Date }];
    expect(runAt.getTime() % 1000).toBe(0);
    expect(runAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(calls.find(({ method }) => method === "subscriptions.update")?.args).toEqual([
      SUBSCRIPTION_ID,
      { metadata: { [M.withdrawnAt]: NOW.toISOString(), [M.withdrawnByUserId]: ACTING_USER.id, [M.resumeAt]: runAt.toISOString() } },
      { idempotencyKey: `eu-withdrawal-record:${SUBSCRIPTION_ID}` },
    ]);
  });

  test("with consent, refunds what the selector computes for the days used", async () => {
    subscription = makeSubscription({ metadata: consentMetadata() });
    const expected = selectWithdrawalRefund({
      invoices: invoices.map((invoice) => toWithdrawalInvoice({ invoice, alreadyCredited: 0 })),
      startedAt: STARTED_AT,
      withdrawnAt: NOW,
      consent: true,
      extraCharges: 0,
    });

    await withdraw();

    expect(expected.kind).toBe("prorated");
    expect(argsOf("creditNotes.create")[0]).toMatchObject({ amount: expected.totalRefund, refund_amount: expected.totalRefund });
    expect(sendReceiptMock).toHaveBeenCalledWith(expect.objectContaining({
      refund: { kind: "prorated", amount: expected.totalRefund, currency: "eur" },
    }));
  });

  test("reads every line of a paid invoice before the refund", async () => {
    invoices = [makeInvoice({ id: "in_1", amountPaid: 3000, linesHasMore: true })];

    await withdraw();

    expect(argsOf("invoices.listLineItems")).toEqual(["in_1", expect.objectContaining({ limit: expect.any(Number) })]);
  });

  // A goodwill credit note from staff is not part of the withdrawal refund.
  test("a credit note that is not ours does not lower the refund; ours does", async () => {
    creditNotes = [
      creditNote({ invoice: "in_1", amount: 1000, metadata: {} }),
      creditNote({ invoice: "in_1", amount: 400, metadata: { [CREDIT_NOTE_WITHDRAWAL_METADATA.subscriptionId]: SUBSCRIPTION_ID } }),
    ];

    await withdraw();

    expect(argsOf("creditNotes.create")[0]).toMatchObject({ amount: 2600, refund_amount: 2600 });
  });

  test("refuses a business customer and writes nothing", async () => {
    subscription = makeSubscription({ customer: { id: CUSTOMER_ID, object: "customer", tax_ids: { data: [{ id: "txi_1" }] } } });

    await expect(withdraw()).rejects.toBeInstanceOf(ActionError);

    expect(methods()).toEqual(["subscriptions.retrieve"]);
  });

  // The right of withdrawal is EU/EEA law: a US consumer without a tax ID does not have it.
  test("refuses a customer outside the EU/EEA and writes nothing", async () => {
    subscription = makeSubscription({ customer: customerIn("US") });

    await expect(withdraw()).rejects.toBeInstanceOf(ActionError);

    expect(methods()).toEqual(["subscriptions.retrieve"]);
  });

  test("a consumer in the EU withdraws", async () => {
    subscription = makeSubscription({ customer: customerIn("BG") });

    await expect(withdraw()).resolves.toEqual({ completed: true });
  });

  test("refuses after the window closes", async () => {
    await expect(withdraw({ now: selectWithdrawalWindowEnd(STARTED_AT) })).rejects.toBeInstanceOf(ActionError);

    expect(fakeStripe.subscriptions.update).not.toHaveBeenCalled();
    expect(enqueueResumeMock).not.toHaveBeenCalled();
  });

  test("a recorded withdrawal resumes: no new job, no second claim, no second receipt", async () => {
    subscription = makeSubscription({ metadata: recorded({ [M.receiptSentAt]: NOW.toISOString() }) });

    await expect(withdraw()).resolves.toEqual({ completed: true });

    expect(enqueueResumeMock).not.toHaveBeenCalled();
    expect(fakeStripe.subscriptions.update).not.toHaveBeenCalled();
    expect(sendReceiptMock).not.toHaveBeenCalled();
    expect(fakeStripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  test("a recorded withdrawal without a receipt sends it now", async () => {
    subscription = makeSubscription({ metadata: recorded({}) });

    await withdraw();

    expect(sendReceiptMock).toHaveBeenCalledTimes(1);
    expect(subscription.metadata[M.receiptSentAt]).toEqual(expect.any(String));
  });

  test("a lost claim response reads the subscription again and finishes", async () => {
    lostResponse = "subscriptions.update";

    await expect(withdraw()).resolves.toEqual({ completed: true });

    expect(sendReceiptMock).toHaveBeenCalledTimes(1);
    expect(fakeStripe.creditNotes.create).toHaveBeenCalledTimes(1);
  });

  // A fast double click: the second request's claim fails on the idempotency key.
  test("a claim refused because another request recorded it first finishes the withdrawal", async () => {
    failures.set("subscriptions.update", stripeError({ type: "StripeIdempotencyError", statusCode: 400 }));
    fakeStripe.subscriptions.retrieve.mockImplementationOnce(async (...args: unknown[]) => {
      calls.push({ method: "subscriptions.retrieve", args });
      return subscription;
    });
    fakeStripe.subscriptions.retrieve.mockImplementationOnce(async (...args: unknown[]) => {
      calls.push({ method: "subscriptions.retrieve", args });
      subscription = makeSubscription({ metadata: recorded({ [M.receiptSentAt]: NOW.toISOString() }) });
      return subscription;
    });

    await expect(withdraw()).resolves.toEqual({ completed: true });

    expect(sendReceiptMock).not.toHaveBeenCalled();
    expect(fakeStripe.subscriptions.cancel).toHaveBeenCalled();
  });

  test("a claim that did not land fails the request; the saved job then finds nothing to do", async () => {
    failures.set("subscriptions.update", stripeError({ type: "StripeAPIError", statusCode: 500 }));

    await expect(withdraw()).rejects.toThrow("Stripe failed");

    expect(enqueueResumeMock).toHaveBeenCalledTimes(1);
    expect(sendReceiptMock).not.toHaveBeenCalled();
    expect(fakeStripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  test("a failed job save stops before the claim", async () => {
    enqueueResumeMock.mockRejectedValueOnce(new Error("D1 is unreachable"));

    await expect(withdraw()).rejects.toThrow("D1 is unreachable");

    expect(fakeStripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("a Stripe failure after the claim leaves the rest to the saved job", async () => {
    failures.set("subscriptions.cancel", stripeError({ type: "StripeAPIError", statusCode: 500 }));

    await expect(withdraw()).resolves.toEqual({ completed: false });

    expect(sendReceiptMock).toHaveBeenCalledTimes(1);
    expect(enqueueResumeMock).toHaveBeenCalledTimes(1);
    expect(fakeStripe.creditNotes.create).not.toHaveBeenCalled();
  });

  // The refund does not wait for the receipt, but the withdrawal is not complete without it.
  test("a failed receipt is not marked as sent, does not stop the refund, and leaves the withdrawal pending", async () => {
    sendReceiptMock.mockRejectedValueOnce(new Error("Queue is unavailable"));

    await expect(withdraw()).resolves.toEqual({ completed: false });

    expect(subscription.metadata[M.receiptSentAt]).toBeUndefined();
    expect(fakeStripe.creditNotes.create).toHaveBeenCalledTimes(1);
  });

  test("an invoice with no charge is left to the resume job", async () => {
    invoices = [makeInvoice({ id: "in_1", amountPaid: 3000, charged: false })];

    await expect(withdraw()).resolves.toEqual({ completed: false });

    expect(fakeStripe.creditNotes.create).not.toHaveBeenCalled();
  });

  test("a failed reconcile does not fail the withdrawal", async () => {
    reconcileMock.mockRejectedValueOnce(new Error("D1 is unreachable"));

    await expect(withdraw()).resolves.toEqual({ completed: true });
  });
});

// Stripe sets `start_date` when the checkout dialog opens and keeps an incomplete subscription up
// to 23 hours. The contract starts when the consumer pays, so the window and the used days count from there.
describe("a checkout paid 20 hours after the dialog opened", () => {
  const OPENED_AT = new Date(STARTED_AT.getTime() - 20 * 60 * 60 * 1000);

  beforeEach(() => {
    subscription = makeSubscription({ start_date: toSeconds(OPENED_AT), metadata: consentMetadata() });
    invoices = [makeInvoice({ id: "in_1", amountPaid: 3000, periodStart: OPENED_AT })];
  });

  test("the window ends after the payment time, not after the dialog time", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    getTeamSubscriptionMock.mockResolvedValue(teamRow({ status: "active" }));

    const offer = await getWithdrawalOffer("team-late-payment");

    expect(offer).toMatchObject({ startedAt: STARTED_AT, windowEndsAt: selectWithdrawalWindowEnd(STARTED_AT) });
    expect(selectWithdrawalWindowEnd(OPENED_AT).getTime()).toBeLessThan(selectWithdrawalWindowEnd(STARTED_AT).getTime());
    vi.useRealTimers();
  });

  // 5 hours after the payment is day 1 of use; counted from the dialog it would be day 2.
  test("the receipt and the pro-rata count from the payment, not the unpaid hours", async () => {
    const withdrawnAt = new Date(STARTED_AT.getTime() + 5 * 60 * 60 * 1000);
    const refundFrom = (startedAt: Date) => selectWithdrawalRefund({
      invoices: invoices.map((invoice) => toWithdrawalInvoice({ invoice, alreadyCredited: 0 })),
      startedAt,
      withdrawnAt,
      consent: true,
      extraCharges: 0,
    }).totalRefund;

    await withdraw({ now: withdrawnAt });

    expect(sendReceiptMock).toHaveBeenCalledWith(expect.objectContaining({ startedAt: STARTED_AT }));
    expect(argsOf("creditNotes.create")[0]).toMatchObject({ amount: refundFrom(STARTED_AT) });
    expect(refundFrom(STARTED_AT)).toBeGreaterThan(refundFrom(OPENED_AT));
  });
});

describe("resumeWithdrawal", () => {
  const RECORDED_AT = new Date(NOW.getTime() - DAY_IN_MS);
  const SCHEDULED_FOR = "2026-03-04T10:00:00.000Z";

  beforeEach(() => {
    subscription = makeSubscription({ metadata: recorded({ [M.withdrawnAt]: RECORDED_AT.toISOString(), [M.resumeAt]: SCHEDULED_FOR }) });
  });

  test("cancels, clears, and refunds; sends a missing receipt to the user who withdrew", async () => {
    await expect(resume()).resolves.toEqual({ completed: true });

    expect(methods()).toEqual([
      "subscriptions.retrieve",
      "invoices.list",
      "receipt",
      "subscriptions.update",
      "subscriptions.cancel",
      "invoices.list",
      "invoiceItems.list",
      "creditNotes.list",
      "creditNotes.create",
    ]);
    expect(findUserMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ACTING_USER.id } }));
    expect(sendReceiptMock).toHaveBeenCalledWith(expect.objectContaining({
      email: ACTING_USER.email,
      name: withdrawalSignerName({ firstName: "Ana", lastName: "Ruiz", email: ACTING_USER.email }),
      teamName: TEAM.name,
      withdrawnAt: RECORDED_AT,
      locale: DEFAULT_LOCALE,
    }));
    expect(enqueueResumeMock).not.toHaveBeenCalled();
  });

  test.each([
    ["another job owns the chain", { [M.resumeAt]: "2026-03-04T11:00:00.000Z" }],
    ["staff already took over", { [M.needsStaffAt]: NOW.toISOString() }],
  ])("stops at once when %s", async (__case, metadata) => {
    subscription = makeSubscription({ metadata: { ...subscription.metadata, ...metadata } });

    await expect(resume()).resolves.toEqual({ completed: false });

    expect(methods()).toEqual(["subscriptions.retrieve"]);
    expect(enqueueResumeMock).not.toHaveBeenCalled();
  });

  // The action saves the job before its claim; a claim that failed leaves nothing to resume.
  test("stops at once when no withdrawal is recorded", async () => {
    subscription = makeSubscription({});

    await expect(resume()).resolves.toEqual({ completed: false });

    expect(methods()).toEqual(["subscriptions.retrieve"]);
  });

  test.each([
    ["the receipt send fails", () => sendReceiptMock.mockRejectedValueOnce(new Error("Queue is unavailable"))],
    ["the user who withdrew has no email address", () => findUserMock.mockResolvedValueOnce({ id: ACTING_USER.id, email: null })],
  ])("keeps the chain going after the refunds when %s", async (__case, arrange) => {
    arrange();

    await expect(resume()).resolves.toEqual({ completed: false });

    expect(fakeStripe.creditNotes.create).toHaveBeenCalledTimes(1);
    expect(subscription.metadata[M.receiptSentAt]).toBeUndefined();
    expect(enqueueResumeMock).toHaveBeenCalledTimes(1);
  });

  test("a later run sends the missing receipt and completes", async () => {
    sendReceiptMock.mockRejectedValueOnce(new Error("Queue is unavailable"));
    await resume();
    const [{ runAt }] = argsOf("enqueue") as [{ runAt: Date }];

    await expect(resumeWithdrawal({
      teamId: TEAM.id,
      subscriptionId: SUBSCRIPTION_ID,
      scheduledFor: runAt.toISOString(),
      now: runAt,
      stripe: fakeStripe,
    })).resolves.toEqual({ completed: true });

    expect(sendReceiptMock).toHaveBeenCalledTimes(2);
    expect(fakeStripe.creditNotes.create).toHaveBeenCalledTimes(1);
  });

  test("a Stripe server error schedules the next job, then hands the chain to it", async () => {
    subscription = makeSubscription({ metadata: { ...subscription.metadata, [M.receiptSentAt]: NOW.toISOString() } });
    failures.set("creditNotes.create", stripeError({ type: "StripeAPIError", statusCode: 500 }));

    await expect(resume()).resolves.toEqual({ completed: false });

    const [{ runAt }] = argsOf("enqueue") as [{ runAt: Date }];
    expect(runAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(methods().slice(-2)).toEqual(["enqueue", "subscriptions.update"]);
    expect(subscription.metadata[M.resumeAt]).toBe(runAt.toISOString());
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("eu_withdrawal_refund_overdue"));
  });

  test.each([
    ["a refused Stripe request", () => failures.set("creditNotes.create", stripeError({ type: "StripeInvalidRequestError", statusCode: 400, code: "charge_already_refunded" }))],
    ["an invoice with no charge", () => {
      invoices = [makeInvoice({ id: "in_1", amountPaid: 3000, charged: false })];
    }],
  ])("%s marks the withdrawal for staff, logs once, and ends the chain", async (__case, arrange) => {
    arrange();

    await expect(resume()).resolves.toEqual({ completed: false });

    expect(subscription.metadata[M.needsStaffAt]).toBe(NOW.toISOString());
    expect(staffLines()).toHaveLength(1);
    expect(enqueueResumeMock).not.toHaveBeenCalled();
  });

  test("logs the overdue refund after the deadline and keeps going", async () => {
    failures.set("creditNotes.create", stripeError({ type: "StripeAPIError", statusCode: 500 }));

    await resume({ now: new Date(RECORDED_AT.getTime() + REFUND_DEADLINE_DAYS * DAY_IN_MS) });

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("eu_withdrawal_refund_overdue"));
    expect(enqueueResumeMock).toHaveBeenCalledTimes(1);
  });

  test("gives up with one log line after the maximum age", async () => {
    failures.set("creditNotes.create", stripeError({ type: "StripeAPIError", statusCode: 500 }));

    await resume({ now: new Date(RECORDED_AT.getTime() + 60 * DAY_IN_MS) });

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("eu_withdrawal_resume_gave_up"));
    expect(enqueueResumeMock).not.toHaveBeenCalled();
  });

  test("a failed reschedule throws before it hands over the chain, so the queue retries this job", async () => {
    failures.set("creditNotes.create", stripeError({ type: "StripeAPIError", statusCode: 500 }));
    enqueueResumeMock.mockRejectedValueOnce(new Error("D1 is unreachable"));

    await expect(resume()).rejects.toThrow("D1 is unreachable");

    expect(subscription.metadata[M.resumeAt]).toBe(SCHEDULED_FOR);
  });
});

describe("getWithdrawalOffer", () => {
  test("reads nothing from Stripe when the team row has no withdrawable subscription", async () => {
    getTeamSubscriptionMock.mockResolvedValue(teamRow({ status: "canceled" }));

    await expect(getWithdrawalOffer("team-no-sub")).resolves.toBeNull();

    expect(getStripeMock).not.toHaveBeenCalled();
  });

  test("offers the window of an eligible subscription", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    getTeamSubscriptionMock.mockResolvedValue(teamRow({ status: "active" }));

    await expect(getWithdrawalOffer("team-offer")).resolves.toEqual({
      planName: expect.any(String),
      startedAt: STARTED_AT,
      windowEndsAt: selectWithdrawalWindowEnd(STARTED_AT),
      pending: false,
    });
    vi.useRealTimers();
  });

  test.each([
    ["US", null],
    ["DE", false],
  ])("a consumer in %s gets the card: %s", async (country, pending) => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    subscription = makeSubscription({ customer: customerIn(country) });
    getTeamSubscriptionMock.mockResolvedValue(teamRow({ status: "active" }));

    const offer = await getWithdrawalOffer(`team-${country}`);

    expect(offer?.pending ?? null).toBe(pending);
    vi.useRealTimers();
  });

  test("hides the card when Stripe fails", async () => {
    getTeamSubscriptionMock.mockResolvedValue(teamRow({ status: "active" }));
    failures.set("subscriptions.retrieve", stripeError({ type: "StripeAPIError", statusCode: 500 }));

    await expect(getWithdrawalOffer("team-stripe-down")).resolves.toBeNull();

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("eu_withdrawal_offer_failed"));
  });
});

describe("withdrawalSignerName", () => {
  test("uses the full name, else the email", () => {
    expect(withdrawalSignerName({ firstName: " Ana ", lastName: "Ruiz", email: "a@example.com" })).toBe("Ana Ruiz");
    expect(withdrawalSignerName({ firstName: null, lastName: " ", email: "a@example.com" })).toBe("a@example.com");
  });
});

function withdraw({ now = NOW }: { now?: Date } = {}) {
  return withdrawFromContract({ team: TEAM, subscriptionId: SUBSCRIPTION_ID, actingUser: ACTING_USER, now, stripe: fakeStripe });
}

function resume({ now = NOW }: { now?: Date } = {}) {
  return resumeWithdrawal({
    teamId: TEAM.id,
    subscriptionId: SUBSCRIPTION_ID,
    scheduledFor: "2026-03-04T10:00:00.000Z",
    now,
    stripe: fakeStripe,
  });
}

function record<T>({ method, args, result }: { method: string; args: unknown[]; result: () => T }): T {
  calls.push({ method, args });
  const failure = failures.get(method);
  if (failure) {
    throw failure;
  }
  const value = result();
  if (lostResponse === method) {
    lostResponse = null;
    throw stripeError({ type: "StripeConnectionError", statusCode: undefined });
  }
  return value;
}

function stripeError(fields: { type: string; statusCode: number | undefined; code?: string }): Error {
  return Object.assign(new Error("Stripe failed"), fields);
}

function methods(): string[] {
  return calls.map(({ method }) => method);
}

function argsOf(method: string): unknown[] {
  const call = calls.find((entry) => entry.method === method);
  if (!call) {
    throw new Error(`${method} was not called`);
  }
  return call.args;
}

function staffLines(): unknown[] {
  return vi.mocked(console.error).mock.calls.filter(([text]) => String(text).includes("eu_withdrawal_refund_needs_staff"));
}

function recorded(extra: Record<string, string>): Record<string, string> {
  return { teamId: TEAM.id, [M.withdrawnAt]: NOW.toISOString(), [M.withdrawnByUserId]: ACTING_USER.id, ...extra };
}

function consentMetadata(): Record<string, string> {
  return { teamId: TEAM.id, [M.consentAt]: STARTED_AT.toISOString(), [M.consentText]: "Start now" };
}

function teamRow({ status }: { status: string }) {
  return { planId: "free", status, stripeSubscriptionId: SUBSCRIPTION_ID };
}

function makeSubscription(fields: Record<string, unknown>): Stripe.Subscription {
  return {
    id: SUBSCRIPTION_ID,
    object: "subscription",
    status: "active",
    start_date: Math.floor(STARTED_AT.getTime() / 1000),
    currency: "eur",
    customer: { id: CUSTOMER_ID, object: "customer", tax_ids: { data: [] } },
    metadata: { teamId: TEAM.id },
    items: { data: [] },
    cancel_at_period_end: false,
    trial_start: null,
    // The first invoice, paid at the order: the contract start (`readContractStart`).
    latest_invoice: { id: "in_1", billing_reason: "subscription_create", status_transitions: { paid_at: toSeconds(STARTED_AT) } },
    ...fields,
  } as unknown as Stripe.Subscription;
}

function toSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function makeInvoice({
  id,
  status = "paid",
  amountPaid,
  charged = true,
  linesHasMore = false,
  periodStart = STARTED_AT,
}: {
  id: string;
  status?: string;
  amountPaid: number;
  charged?: boolean;
  linesHasMore?: boolean;
  periodStart?: Date;
}): Stripe.Invoice {
  return {
    id,
    object: "invoice",
    status,
    currency: "eur",
    amount_paid: amountPaid,
    status_transitions: { paid_at: status === "paid" ? Math.floor(STARTED_AT.getTime() / 1000) : null },
    lines: { object: "list", data: [line({ id: "il_1", amount: amountPaid, periodStart })], has_more: linesHasMore },
    payments: {
      data: [{ status: "paid", payment: { type: charged ? "payment_intent" : "payment_record" } }],
    },
  } as unknown as Stripe.Invoice;
}

function line({ id, amount, periodStart = STARTED_AT }: { id: string; amount: number; periodStart?: Date }): Stripe.InvoiceLineItem {
  return {
    id,
    amount,
    period: { start: toSeconds(periodStart), end: toSeconds(PERIOD_END) },
  } as unknown as Stripe.InvoiceLineItem;
}

function pendingItem({ id, subscriptionId }: { id: string; subscriptionId: string }): Stripe.InvoiceItem {
  return { id, parent: { type: "subscription_details", subscription_details: { subscription: subscriptionId } } } as unknown as Stripe.InvoiceItem;
}

function creditNote(fields: Record<string, unknown>): Stripe.CreditNote {
  return { object: "credit_note", status: "issued", ...fields } as unknown as Stripe.CreditNote;
}

function customerIn(country: string) {
  return { id: CUSTOMER_ID, object: "customer", address: { country }, tax_ids: { data: [] } };
}
