import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { DAY_IN_MS } from "@/constants";
import { CREDIT_NOTE_WITHDRAWAL_METADATA } from "@/constants/eu-withdrawal";
import { readWithdrawalMetadata } from "@/lib/billing/eu-withdrawal-selectors";

const { reconcileMock } = vi.hoisted(() => ({ reconcileMock: vi.fn(async () => "team-1") }));

vi.mock("server-only", () => ({}));
vi.mock("@/utils/team-subscription", () => ({ reconcileTeamFromSubscription: reconcileMock }));

const { issueWithdrawalRefunds, prepareRefunds } = await import("./eu-withdrawal-refunds");

const STARTED_AT = new Date("2026-03-01T09:30:00.000Z");
const NOW = new Date(STARTED_AT.getTime() + 3 * DAY_IN_MS);
const PERIOD_END = new Date(STARTED_AT.getTime() + 30 * DAY_IN_MS);
const SUBSCRIPTION_ID = "sub_eu";
const OURS = { [CREDIT_NOTE_WITHDRAWAL_METADATA.subscriptionId]: SUBSCRIPTION_ID };

let calls: { method: string; args: unknown[] }[] = [];
let invoices: Stripe.Invoice[];
let creditNotes: Stripe.CreditNote[];
let failures: Map<string, Error>;
// The refunded sum of each payment intent's charge.
let chargeRefunded: Map<string, number>;

const fakeStripe = {
  subscriptions: {
    cancel: vi.fn(async (...args: unknown[]) => record({ method: "subscriptions.cancel", args, result: () => subscriptionWith({ status: "canceled" }) })),
  },
  invoices: {
    list: vi.fn(async (...args: unknown[]) => record({ method: "invoices.list", args, result: () => ({ data: invoices }) })),
    listLineItems: vi.fn(async (...args: unknown[]) => record({
      method: "invoices.listLineItems",
      args,
      result: () => ({ data: [line({ id: "il_2", amount: 500 })], has_more: false }),
    })),
    voidInvoice: vi.fn(async (...args: unknown[]) => record({ method: "invoices.voidInvoice", args, result: () => ({}) as Stripe.Invoice })),
    // A draft with a zero total is paid at once when Stripe finalizes it.
    finalizeInvoice: vi.fn(async (...args: unknown[]) => record({
      method: "invoices.finalizeInvoice",
      args,
      result: () => {
        const draft = invoices.find(({ id }) => id === args[0]);
        return { ...draft, status: draft?.total === 0 ? "paid" : "open" } as Stripe.Invoice;
      },
    })),
  },
  paymentIntents: {
    retrieve: vi.fn(async (...args: unknown[]) => record({
      method: "paymentIntents.retrieve",
      args,
      result: () => ({ latest_charge: { amount_refunded: chargeRefunded.get(String(args[0])) ?? 0 } }) as unknown as Stripe.PaymentIntent,
    })),
  },
  charges: {
    retrieve: vi.fn(async (...args: unknown[]) => record({ method: "charges.retrieve", args, result: () => ({ amount_refunded: 0 }) as Stripe.Charge })),
  },
  invoiceItems: {
    list: vi.fn(async (...args: unknown[]) => record({ method: "invoiceItems.list", args, result: () => ({ data: [] as Stripe.InvoiceItem[] }) })),
    del: vi.fn(async (...args: unknown[]) => record({ method: "invoiceItems.del", args, result: () => ({}) as Stripe.DeletedInvoiceItem })),
  },
  creditNotes: {
    create: vi.fn(async (...args: unknown[]) => record({
      method: "creditNotes.create",
      args,
      result: () => {
        const params = args[0] as Stripe.CreditNoteCreateParams;
        const note = creditNote({ invoice: params.invoice, amount: params.amount, metadata: params.metadata });
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
  chargeRefunded = new Map();
  invoices = [makeInvoice({ id: "in_1", amountPaid: 3000 })];
  creditNotes = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("prepareRefunds and issueWithdrawalRefunds", () => {
  test("reads every line of a paid invoice before the refund", async () => {
    invoices = [makeInvoice({ id: "in_1", amountPaid: 3000, linesHasMore: true })];

    await expect(refund()).resolves.toEqual({ status: "done" });

    expect(argsOf("invoices.listLineItems")).toEqual(["in_1", expect.objectContaining({ limit: expect.any(Number) })]);
  });

  // A goodwill credit note from staff is not part of the withdrawal refund.
  test("a credit note that is not ours does not lower the refund; ours does", async () => {
    creditNotes = [
      creditNote({ invoice: "in_1", amount: 1000, metadata: {} }),
      creditNote({ invoice: "in_1", amount: 400, metadata: OURS }),
    ];

    await refund();

    expect(argsOf("creditNotes.create")[0]).toMatchObject({ amount: 2600, refund_amount: 2600 });
  });

  test("a draft with a zero total is paid when finalized, so there is nothing to void", async () => {
    invoices = [makeInvoice({ id: "in_1", amountPaid: 3000 }), makeInvoice({ id: "in_zero", status: "draft", amountPaid: 0, total: 0 })];

    await expect(refund()).resolves.toEqual({ status: "done" });

    expect(fakeStripe.invoices.finalizeInvoice).toHaveBeenCalledTimes(1);
    expect(fakeStripe.invoices.voidInvoice).not.toHaveBeenCalled();
  });

  // One refusal must not hold back the other refunds; the refused invoice goes to staff.
  test("a refused void still lets every refund go out", async () => {
    invoices = [makeInvoice({ id: "in_1", amountPaid: 3000 }), makeInvoice({ id: "in_open", status: "open", amountPaid: 0 })];
    failures.set("invoices.voidInvoice", stripeError({ type: "StripeInvalidRequestError", statusCode: 400 }));

    await expect(refund()).resolves.toEqual({ status: "needs_staff", reason: "stripe_refused", invoiceIds: ["in_open"] });

    expect(argsOf("creditNotes.create")[0]).toMatchObject({ invoice: "in_1", amount: 3000 });
  });

  test("a refused credit note on one invoice still refunds the others", async () => {
    invoices = [makeInvoice({ id: "in_a", amountPaid: 1000 }), makeInvoice({ id: "in_b", amountPaid: 2000 })];
    fakeStripe.creditNotes.create.mockImplementationOnce(async (...args: unknown[]) => {
      calls.push({ method: "creditNotes.create", args });
      throw stripeError({ type: "StripeInvalidRequestError", statusCode: 400, code: "charge_disputed" });
    });

    await expect(refund()).resolves.toEqual({ status: "needs_staff", reason: "stripe_refused", invoiceIds: ["in_a"] });

    expect(fakeStripe.creditNotes.create).toHaveBeenCalledTimes(2);
    expect(creditNotes.map(({ invoice }) => invoice)).toEqual(["in_b"]);
  });

  // Stripe refuses a credit note above what the invoice can still credit. A staff credit note and
  // a direct refund both lower that sum; the rest of the refund goes to staff.
  test("caps the credit note at what Stripe can still credit", async () => {
    invoices = [makeInvoice({ id: "in_1", amountPaid: 3000, postPaymentCredited: 1000 })];
    creditNotes = [creditNote({ invoice: "in_1", amount: 1000, metadata: {}, refunds: [] })];
    chargeRefunded.set("pi_in_1", 500);

    await expect(refund()).resolves.toEqual({ status: "needs_staff", reason: "refund_capped", invoiceIds: ["in_1"] });

    expect(argsOf("creditNotes.create")[0]).toMatchObject({ amount: 1500, refund_amount: 1500 });
  });

  test("an invoice with no charge goes to staff", async () => {
    invoices = [makeInvoice({ id: "in_1", amountPaid: 3000, charged: false })];

    await expect(refund()).resolves.toEqual({ status: "needs_staff", reason: "no_charge", invoiceIds: ["in_1"] });

    expect(fakeStripe.creditNotes.create).not.toHaveBeenCalled();
  });

  test("a failed read comes back as a result: a retry for a server error, staff for a refusal", async () => {
    failures.set("invoices.list", stripeError({ type: "StripeAPIError", statusCode: 500 }));
    await expect(prepare()).resolves.toEqual({ ok: false, result: { status: "retry" } });

    failures.set("invoices.list", stripeError({ type: "StripeInvalidRequestError", statusCode: 404 }));
    await expect(prepare()).resolves.toEqual({ ok: false, result: { status: "needs_staff", reason: "stripe_refused", invoiceIds: [] } });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("eu_withdrawal_step_failed"));
  });
});

function prepare() {
  const subscription = subscriptionWith({});
  return prepareRefunds({
    stripe: fakeStripe,
    subscription,
    record: readWithdrawalMetadata(subscription.metadata),
    startedAt: STARTED_AT,
    withdrawnAt: NOW,
  });
}

async function refund() {
  const preparation = await prepare();
  if (!preparation.ok) {
    return preparation.result;
  }

  return issueWithdrawalRefunds({ stripe: fakeStripe, subscriptionId: SUBSCRIPTION_ID, prepared: preparation.prepared });
}

function record<T>({ method, args, result }: { method: string; args: unknown[]; result: () => T }): T {
  calls.push({ method, args });
  const failure = failures.get(method);
  if (failure) {
    throw failure;
  }
  return result();
}

function stripeError(fields: { type: string; statusCode: number; code?: string }): Error {
  return Object.assign(new Error("Stripe failed"), fields);
}

function argsOf(method: string): unknown[] {
  const call = calls.find((entry) => entry.method === method);
  if (!call) {
    throw new Error(`${method} was not called`);
  }
  return call.args;
}

function subscriptionWith(fields: Record<string, unknown>): Stripe.Subscription {
  return {
    id: SUBSCRIPTION_ID,
    object: "subscription",
    status: "active",
    start_date: toSeconds(STARTED_AT),
    currency: "eur",
    customer: "cus_1",
    metadata: { teamId: "team-1" },
    items: { data: [] },
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
  total = 1000,
  charged = true,
  linesHasMore = false,
  postPaymentCredited = 0,
}: {
  id: string;
  status?: string;
  amountPaid: number;
  // Read only for a draft: a zero total is paid when it is finalized.
  total?: number;
  charged?: boolean;
  linesHasMore?: boolean;
  postPaymentCredited?: number;
}): Stripe.Invoice {
  return {
    id,
    object: "invoice",
    status,
    currency: "eur",
    amount_paid: amountPaid,
    total,
    post_payment_credit_notes_amount: postPaymentCredited,
    status_transitions: { paid_at: status === "paid" ? toSeconds(STARTED_AT) : null },
    lines: { object: "list", data: [line({ id: "il_1", amount: amountPaid })], has_more: linesHasMore },
    payments: {
      data: [{
        status: "paid",
        payment: charged ? { type: "payment_intent", payment_intent: `pi_${id}` } : { type: "payment_record" },
      }],
    },
  } as unknown as Stripe.Invoice;
}

function line({ id, amount }: { id: string; amount: number }): Stripe.InvoiceLineItem {
  return { id, amount, period: { start: toSeconds(STARTED_AT), end: toSeconds(PERIOD_END) } } as unknown as Stripe.InvoiceLineItem;
}

function creditNote(fields: Record<string, unknown>): Stripe.CreditNote {
  return { object: "credit_note", status: "issued", ...fields } as unknown as Stripe.CreditNote;
}
