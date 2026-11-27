import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { DAY_IN_MS } from "@/constants";
import { CREDIT_NOTE_WITHDRAWAL_METADATA, SUBSCRIPTION_WITHDRAWAL_METADATA } from "@/constants/eu-withdrawal";

const { enqueueResumeMock, getStripeMock, reconcileMock } = vi.hoisted(() => ({
  enqueueResumeMock: vi.fn(),
  getStripeMock: vi.fn(),
  reconcileMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/stripe", () => ({ getStripe: getStripeMock }));
vi.mock("@/lib/scheduler/enqueue", () => ({ enqueueEuWithdrawalResume: enqueueResumeMock }));
vi.mock("@/utils/team-subscription", () => ({ reconcileTeamFromSubscription: reconcileMock }));

const { flagFailedWithdrawalRefund, recoverStalledWithdrawals } = await import("./eu-withdrawal-recovery");

const M = SUBSCRIPTION_WITHDRAWAL_METADATA;
const TEAM_ID = "team-1";
const SUBSCRIPTION_ID = "sub_eu";
const RESUME_AT = "2026-03-04T10:00:00.000Z";
const LATER = new Date(new Date(RESUME_AT).getTime() + DAY_IN_MS);

let searchPages: { data: Stripe.Subscription[]; has_more: boolean; next_page: string | null }[];
let invoicePayments: Stripe.InvoicePayment[];
let creditNotes: Stripe.CreditNote[];
let metadataWrites: { id: string; metadata: Record<string, string> }[];

const fakeStripe = {
  subscriptions: {
    search: vi.fn(async (__params: Stripe.SubscriptionSearchParams) => searchPages.shift() ?? { data: [], has_more: false, next_page: null }),
    update: vi.fn(async (id: string, params: Stripe.SubscriptionUpdateParams) => {
      metadataWrites.push({ id, metadata: params.metadata as Record<string, string> });
      return {} as Stripe.Subscription;
    }),
  },
  invoicePayments: {
    list: vi.fn(async (__params: Stripe.InvoicePaymentListParams) => ({ data: invoicePayments })),
  },
  creditNotes: {
    list: vi.fn(async ({ invoice }: Stripe.CreditNoteListParams) => ({ data: creditNotes.filter((note) => note.invoice === invoice) })),
  },
};

beforeEach(() => {
  searchPages = [];
  invoicePayments = [];
  creditNotes = [];
  metadataWrites = [];
  getStripeMock.mockResolvedValue(fakeStripe);
  enqueueResumeMock.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("recoverStalledWithdrawals", () => {
  test("enqueues the job that a stopped chain names, and skips a live or complete one", async () => {
    searchPages = [
      {
        data: [
          subscriptionWith({ id: "sub_stalled", metadata: recorded({ [M.resumeAt]: RESUME_AT }) }),
          subscriptionWith({ id: "sub_live", metadata: recorded({ [M.resumeAt]: new Date(LATER.getTime() + 1000).toISOString() }) }),
        ],
        has_more: true,
        next_page: "page_2",
      },
      {
        data: [subscriptionWith({ id: "sub_done", metadata: recorded({ [M.resumeAt]: RESUME_AT, [M.completedAt]: RESUME_AT }) })],
        has_more: false,
        next_page: null,
      },
    ];

    await expect(recoverStalledWithdrawals({ now: LATER, stripe: fakeStripe })).resolves.toBe(1);

    expect(enqueueResumeMock).toHaveBeenCalledWith({ teamId: TEAM_ID, subscriptionId: "sub_stalled", runAt: new Date(RESUME_AT) });
    const [first, second] = fakeStripe.subscriptions.search.mock.calls.map(([params]) => params);
    expect(first).toMatchObject({ query: expect.stringContaining(`-metadata["${M.withdrawnAt}"]:null`) });
    expect(second).toMatchObject({ page: "page_2" });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("eu_withdrawal_resume_recovered"));
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  test("one failed enqueue does not stop the others", async () => {
    searchPages = [{
      data: [
        subscriptionWith({ id: "sub_a", metadata: recorded({ [M.resumeAt]: RESUME_AT }) }),
        subscriptionWith({ id: "sub_b", metadata: recorded({ [M.resumeAt]: RESUME_AT }) }),
      ],
      has_more: false,
      next_page: null,
    }];
    enqueueResumeMock.mockRejectedValueOnce(new Error("D1 is unreachable"));

    await expect(recoverStalledWithdrawals({ now: LATER, stripe: fakeStripe })).resolves.toBe(1);

    expect(enqueueResumeMock).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("eu_withdrawal_resume_recovery_failed"));
  });

  // Reconcile can match a team by its customer alone, so the subscription may lack `teamId`.
  test("finds the team by the customer when the metadata has none", async () => {
    const { teamId: __teamId, ...withoutTeam } = recorded({ [M.resumeAt]: RESUME_AT });
    searchPages = [{ data: [subscriptionWith({ metadata: withoutTeam })], has_more: false, next_page: null }];
    reconcileMock.mockResolvedValueOnce("team-by-customer");

    await expect(recoverStalledWithdrawals({ now: LATER, stripe: fakeStripe })).resolves.toBe(1);

    expect(reconcileMock).toHaveBeenCalledWith({ subscription: expect.objectContaining({ id: SUBSCRIPTION_ID }) });
    expect(enqueueResumeMock).toHaveBeenCalledWith(expect.objectContaining({ teamId: "team-by-customer" }));
  });

  test.each([
    ["no team matches", () => reconcileMock.mockResolvedValueOnce(null), "no_team"],
    ["the team lookup fails", () => reconcileMock.mockRejectedValueOnce(new Error("D1 is unreachable")), "team_lookup_failed"],
  ])("logs a failed recovery when %s", async (__case, arrange, reason) => {
    const { teamId: __teamId, ...withoutTeam } = recorded({ [M.resumeAt]: RESUME_AT });
    searchPages = [{ data: [subscriptionWith({ metadata: withoutTeam })], has_more: false, next_page: null }];
    arrange();

    await expect(recoverStalledWithdrawals({ now: LATER, stripe: fakeStripe })).resolves.toBe(0);

    expect(enqueueResumeMock).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`"reason":"${reason}"`));
  });
});

describe("flagFailedWithdrawalRefund", () => {
  const ours = { [CREDIT_NOTE_WITHDRAWAL_METADATA.subscriptionId]: SUBSCRIPTION_ID };
  const failedRefund = { id: "re_1", object: "refund", payment_intent: "pi_in_1", failure_reason: "expired_or_canceled_card" } as Stripe.Refund;

  // The chain must go on: other invoices can still wait for their refunds.
  test("records the failure apart from the staff mark when the refund came from our credit note", async () => {
    invoicePayments = [{ invoice: "in_1" } as Stripe.InvoicePayment];
    creditNotes = [creditNote({ invoice: "in_1", metadata: ours, refunds: [{ amount_refunded: 3000, refund: "re_1" }] })];

    await expect(flagFailedWithdrawalRefund({ refund: failedRefund, stripe: fakeStripe })).resolves.toBe(true);

    expect(fakeStripe.invoicePayments.list).toHaveBeenCalledWith(expect.objectContaining({
      payment: { type: "payment_intent", payment_intent: "pi_in_1" },
    }));
    expect(metadataWrites).toEqual([{ id: SUBSCRIPTION_ID, metadata: { [M.refundFailedAt]: expect.any(String) } }]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("eu_withdrawal_refund_failed"));
  });

  test("the alert fires when the write fails, and the error goes back so that Stripe retries", async () => {
    invoicePayments = [{ invoice: "in_1" } as Stripe.InvoicePayment];
    creditNotes = [creditNote({ invoice: "in_1", metadata: ours, refunds: [{ amount_refunded: 3000, refund: "re_1" }] })];
    fakeStripe.subscriptions.update.mockRejectedValueOnce(Object.assign(new Error("Stripe failed"), { type: "StripeAPIError", statusCode: 500 }));

    await expect(flagFailedWithdrawalRefund({ refund: failedRefund, stripe: fakeStripe })).rejects.toThrow("Stripe failed");

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("eu_withdrawal_refund_failed"));
  });

  test("ignores a refund that is not a withdrawal refund", async () => {
    invoicePayments = [{ invoice: "in_1" } as Stripe.InvoicePayment];
    creditNotes = [creditNote({ invoice: "in_1", metadata: {}, refunds: [{ amount_refunded: 3000, refund: "re_1" }] })];

    await expect(flagFailedWithdrawalRefund({ refund: failedRefund, stripe: fakeStripe })).resolves.toBe(false);

    expect(fakeStripe.subscriptions.update).not.toHaveBeenCalled();
  });
});

function recorded(extra: Record<string, string>): Record<string, string> {
  return { teamId: TEAM_ID, [M.withdrawnAt]: RESUME_AT, [M.withdrawnByUserId]: "user-1", ...extra };
}

function subscriptionWith(fields: Record<string, unknown>): Stripe.Subscription {
  return { id: SUBSCRIPTION_ID, object: "subscription", status: "canceled", customer: "cus_1", ...fields } as unknown as Stripe.Subscription;
}

function creditNote(fields: Record<string, unknown>): Stripe.CreditNote {
  return { object: "credit_note", status: "issued", ...fields } as unknown as Stripe.CreditNote;
}
