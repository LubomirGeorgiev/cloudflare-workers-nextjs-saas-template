/// <reference types="@cloudflare/vitest-plugin/types" />

// The EU withdrawal against real D1: the team row reconcile, the queued receipt, and the durable
// resume job. Stripe is a fake, so each test states what Stripe returns.

import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type Stripe from "stripe";

const { emailSendMock } = vi.hoisted(() => ({ emailSendMock: vi.fn() }));

vi.mock("@/utils/is-local", () => ({ isLocalMode: false }));

// The email path goes through `getCloudflareContext`, so only the email queue send is captured here.
vi.mock("@/utils/cloudflare-context", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/utils/cloudflare-context")>();

  return {
    ...original,
    getCloudflareContext: async () => {
      const context = await original.getCloudflareContext();

      return { ...context, env: { ...context.env, SCHEDULER_QUEUE: { send: emailSendMock } } };
    },
  };
});

import { DEFAULT_PLAN_ID, PAID_PLAN_IDS } from "@/constants/plans";
import { SUBSCRIPTION_WITHDRAWAL_METADATA } from "@/constants/eu-withdrawal";
import { getDB } from "@/db";
import { teamTable } from "@/db/schema";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { resumeWithdrawal, withdrawFromContract, type WithdrawalStripe } from "@/lib/billing/eu-withdrawal";
import {
  emailSendJobPayloadSchema,
  EMAIL_TEMPLATE_TYPES,
  SCHEDULED_JOB_TYPES,
  type ScheduledJobPayload,
} from "@/lib/scheduler/jobs";
import { v } from "@/lib/validation";
import { renderTransactionalEmail } from "@/utils/email";
import { claimTeamSubscription } from "@/utils/team-subscription";

const db = getDB();
const TEAM_ID = "team_eu";
const SUBSCRIPTION_ID = "sub_eu";
const CUSTOMER_ID = "cus_eu";
const PAID_PLAN_ID = PAID_PLAN_IDS[0];
const PAID_PRICE_ID = `price_${PAID_PLAN_ID}_eu_withdrawal`;
const DAY_SECONDS = 24 * 60 * 60;
const AMOUNT_PAID = 2900;
const ACTING_USER = { id: "usr_eu", name: "Ana Ruiz", email: "ana@example.com", locale: DEFAULT_LOCALE };

process.env[`STRIPE_PRICE_${PAID_PLAN_ID.toUpperCase()}`] = PAID_PRICE_ID;

interface FakeStripeState {
  subscription: Stripe.Subscription;
  creditNotes: Stripe.CreditNoteCreateParams[];
  failCancel: boolean;
  deletedDrafts: string[];
}

describe("EU withdrawal", () => {
  let state: FakeStripeState;
  let stripe: WithdrawalStripe;

  beforeEach(async () => {
    await env.D1_DB.batch([
      env.D1_DB.prepare("DELETE FROM team"),
      env.D1_DB.prepare("DELETE FROM scheduled_job"),
    ]);
    emailSendMock.mockReset();
    await db.insert(teamTable).values({
      id: TEAM_ID,
      name: "Acme",
      slug: TEAM_ID,
      subscriptionPlanId: PAID_PLAN_ID,
      subscriptionStatus: "active",
      stripeCustomerId: CUSTOMER_ID,
    });
    await claimTeamSubscription({ teamId: TEAM_ID, subscriptionId: SUBSCRIPTION_ID });
    state = { subscription: makeSubscription(), creditNotes: [], failCancel: false, deletedDrafts: [] };
    stripe = makeFakeStripe(state);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("cancels, moves the team to the free plan, refunds once, and queues a valid receipt", async () => {
    await expect(withdraw()).resolves.toEqual({ completed: true });

    const team = await db.query.teamTable.findFirst({ where: { id: TEAM_ID } });
    expect(team?.subscriptionPlanId).toBe(DEFAULT_PLAN_ID);
    expect(team?.stripeSubscriptionId).toBeNull();
    expect(state.creditNotes).toEqual([expect.objectContaining({ amount: AMOUNT_PAID, refund_amount: AMOUNT_PAID })]);
    expect(state.deletedDrafts).toEqual(["in_draft"]);

    const receipts = queuedEmails().filter((payload) => payload.template === EMAIL_TEMPLATE_TYPES.WITHDRAWAL_RECEIPT);
    expect(receipts).toHaveLength(1);
    const receipt = v.parse(emailSendJobPayloadSchema, receipts[0]);
    const rendered = await renderTransactionalEmail(receipt);
    expect(rendered.to).toBe(ACTING_USER.email);
    expect(rendered.text).toContain(ACTING_USER.name);
  });

  // The job is saved before the claim. Its run time, read back from the D1 row in whole seconds,
  // must match the claim's `eu_resume_at`, or the job would stop as superseded.
  test("a failed cancel leaves a durable resume job that finishes the withdrawal", async () => {
    state.failCancel = true;
    // The resume job is durable: its row stays when the queue send fails.
    vi.spyOn(env.SCHEDULER_QUEUE, "send").mockRejectedValueOnce(new Error("Queue is unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(withdraw()).resolves.toEqual({ completed: false });

    const jobs = await db.query.scheduledJobTable.findMany({
      where: { type: SCHEDULED_JOB_TYPES.BILLING_EU_WITHDRAWAL_RESUME },
    });
    expect(jobs).toHaveLength(1);
    const payload = jobs[0]?.payload as ScheduledJobPayload<typeof SCHEDULED_JOB_TYPES.BILLING_EU_WITHDRAWAL_RESUME>;
    expect(payload).toEqual({ teamId: TEAM_ID, subscriptionId: SUBSCRIPTION_ID });
    expect(state.creditNotes).toEqual([]);

    state.failCancel = false;
    const scheduledFor = jobs[0]?.runAt.toISOString() ?? "";
    expect(state.subscription.metadata[SUBSCRIPTION_WITHDRAWAL_METADATA.resumeAt]).toBe(scheduledFor);
    await expect(resumeWithdrawal({ ...payload, scheduledFor, now: new Date(), stripe })).resolves.toEqual({ completed: true });

    const team = await db.query.teamTable.findFirst({ where: { id: TEAM_ID } });
    expect(team?.subscriptionPlanId).toBe(DEFAULT_PLAN_ID);
    expect(state.creditNotes).toHaveLength(1);
    // Only the request that recorded the withdrawal sends the receipt.
    expect(queuedEmails().filter((email) => email.template === EMAIL_TEMPLATE_TYPES.WITHDRAWAL_RECEIPT)).toHaveLength(1);
  });

  test("a second withdrawal neither records again nor refunds twice", async () => {
    await withdraw();
    await withdraw();

    expect(state.creditNotes).toHaveLength(1);
    expect(queuedEmails().filter((email) => email.template === EMAIL_TEMPLATE_TYPES.WITHDRAWAL_RECEIPT)).toHaveLength(1);
  });

  function withdraw() {
    return withdrawFromContract({
      team: { id: TEAM_ID, name: "Acme", subscriptionPlanId: PAID_PLAN_ID },
      subscriptionId: SUBSCRIPTION_ID,
      actingUser: ACTING_USER,
      now: new Date(),
      stripe,
    });
  }
});

function queuedEmails(): { template: string }[] {
  return emailSendMock.mock.calls
    .map(([message]) => message as { type: string; payload: { template: string } })
    .filter((message) => message.type === SCHEDULED_JOB_TYPES.EMAIL_SEND)
    .map((message) => message.payload);
}

// Stateful enough for a rerun: the metadata writes, the cancel, and the credit notes stick.
function makeFakeStripe(state: FakeStripeState): WithdrawalStripe {
  return {
    subscriptions: {
      retrieve: async () => state.subscription,
      update: async (__id, params) => {
        state.subscription = {
          ...state.subscription,
          metadata: { ...state.subscription.metadata, ...(params.metadata as Record<string, string>) },
        };
        return state.subscription;
      },
      cancel: async () => {
        if (state.failCancel) {
          throw Object.assign(new Error("Stripe is unavailable"), { type: "StripeAPIError", statusCode: 500 });
        }
        state.subscription = { ...state.subscription, status: "canceled" };
        return { ...state.subscription, customer: CUSTOMER_ID };
      },
    },
    invoices: {
      // The draft stays after the cancel until the flow deletes it.
      list: async () => ({ data: [makeInvoice(), ...(state.deletedDrafts.length > 0 ? [] : [makeDraft()])] }),
      retrieve: async () => makeInvoice(),
      listLineItems: async () => ({ data: [], has_more: false }),
      voidInvoice: async () => ({}) as Stripe.Invoice,
      del: async (id) => {
        state.deletedDrafts.push(id);
        return {} as Stripe.DeletedInvoice;
      },
    },
    invoiceItems: {
      list: async () => ({ data: [] }),
      del: async () => ({}) as Stripe.DeletedInvoiceItem,
    },
    creditNotes: {
      create: async (params) => {
        state.creditNotes.push(params);
        return {} as Stripe.CreditNote;
      },
      list: async ({ invoice }) => ({
        data: state.creditNotes
          .filter((note) => note.invoice === invoice)
          .map((note) => ({ invoice: note.invoice, amount: note.amount, status: "issued", metadata: note.metadata }) as unknown as Stripe.CreditNote),
      }),
    },
  };
}

function makeSubscription(): Stripe.Subscription {
  const startDate = Math.floor(Date.now() / 1000) - 2 * DAY_SECONDS;

  return {
    id: SUBSCRIPTION_ID,
    object: "subscription",
    status: "active",
    start_date: startDate,
    currency: "eur",
    customer: { id: CUSTOMER_ID, object: "customer", tax_ids: { object: "list", data: [] } },
    cancel_at_period_end: false,
    trial_start: null,
    latest_invoice: { id: "in_eu", billing_reason: "subscription_create", status_transitions: { paid_at: startDate } },
    metadata: { teamId: TEAM_ID, [SUBSCRIPTION_WITHDRAWAL_METADATA.orderUserId]: ACTING_USER.id },
    items: {
      object: "list",
      data: [{
        id: "si_eu",
        current_period_end: startDate + 30 * DAY_SECONDS,
        price: { id: PAID_PRICE_ID, recurring: { interval: "month" } },
      }],
    },
  } as unknown as Stripe.Subscription;
}

// A trial-end draft that could still finalize and charge.
function makeDraft(): Stripe.Invoice {
  return { id: "in_draft", object: "invoice", status: "draft", amount_paid: 0, lines: { data: [], has_more: false } } as unknown as Stripe.Invoice;
}

function makeInvoice(): Stripe.Invoice {
  const startDate = Math.floor(Date.now() / 1000) - 2 * DAY_SECONDS;

  return {
    id: "in_eu",
    object: "invoice",
    status: "paid",
    currency: "eur",
    amount_paid: AMOUNT_PAID,
    status_transitions: { paid_at: startDate },
    lines: {
      object: "list",
      has_more: false,
      data: [{ id: "il_eu", amount: AMOUNT_PAID, period: { start: startDate, end: startDate + 30 * DAY_SECONDS } }],
    },
    payments: { object: "list", data: [{ status: "paid", payment: { type: "payment_intent" } }] },
  } as unknown as Stripe.Invoice;
}
