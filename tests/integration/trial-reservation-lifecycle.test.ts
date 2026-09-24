/// <reference types="@cloudflare/vitest-plugin/types" />

// Lifecycle coverage for the trial-reservation state machine against a real Miniflare D1:
// completeTrialSubscription (release-on-success / retain-on-ambiguous / release-on-definite)
// and settleStaleTrialReservations (the crash/ambiguous recovery sweep). Stripe is faked so
// the flow is deterministic; every DB write, unique index, and reconcile runs for real.
//
// NOTE: these rows exercise the recovery columns added to team_trial_reservation
// (stripeSubscriptionId, orphanedSubscriptionId, lastError, lastRecoveryAt); they require the
// regenerated migration that captures those columns.

import { beforeEach, expect, test, vi } from "vitest";

// A single mutable Stripe stand-in the mocked getStripe() returns; each test reconfigures it.
const { stripeState } = vi.hoisted(() => {
  const stripeState: { client: unknown } = { client: null };

  return { stripeState };
});

vi.mock("@/lib/stripe", () => ({
  getStripe: () => stripeState.client,
}));

import { env } from "cloudflare:workers";
import Stripe from "stripe";
import { and, eq } from "drizzle-orm";

import { getDB } from "@/db";
import { teamTable, teamTrialReservationTable, userTable } from "@/db/schema";
import { PAID_PLAN_IDS, TEAM_PLANS, type TeamPlanId } from "@/constants/plans";
import { isTrialEligible } from "@/utils/team-subscription";
import { TRIAL_SETUP_PENDING_REASON } from "@/lib/billing/payment-return";
import {
  completeTrialSubscription,
  settleStaleTrialReservations,
  type TrialSubscriptionStripe,
} from "@/lib/teams/trial-subscription";

const db = getDB();
const dayInMs = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// Template-safe: derive the plan under test from the catalog rather than a literal name. The
// service reads the trial length from the plan, so prefer a paid plan that offers a trial.
const PAID_PLAN_ID: TeamPlanId =
  PAID_PLAN_IDS.find((planId) => (TEAM_PLANS[planId].trialDays ?? 0) > 0) ?? PAID_PLAN_IDS[0];
const HAS_TRIAL_PLAN = (TEAM_PLANS[PAID_PLAN_ID].trialDays ?? 0) > 0;
const PAID_PRICE_ID = `price_${PAID_PLAN_ID}_lifecycle`;
process.env[`STRIPE_PRICE_${PAID_PLAN_ID.toUpperCase()}`] = PAID_PRICE_ID;

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

async function clearRows(): Promise<void> {
  await env.D1_DB.batch([
    env.D1_DB.prepare("DELETE FROM team_trial_reservation"),
    env.D1_DB.prepare("DELETE FROM team_membership"),
    env.D1_DB.prepare("DELETE FROM team"),
    env.D1_DB.prepare("DELETE FROM user"),
  ]);
}

async function seedTeamAndUser({
  customerId,
  teamSubscriptionId = null,
}: {
  customerId: string;
  teamSubscriptionId?: string | null;
}): Promise<{ teamId: string; userId: string }> {
  const teamId = uid("team");
  const userId = uid("usr");
  await db.insert(userTable).values({ id: userId, email: `${userId}@example.com` });
  await db.insert(teamTable).values({
    id: teamId,
    name: "Lifecycle Team",
    slug: uid("lc"),
    stripeCustomerId: customerId,
    stripeSubscriptionId: teamSubscriptionId,
  });
  return { teamId, userId };
}

function makeSubscription({
  id,
  status,
  teamId,
  customerId,
}: {
  id: string;
  status: Stripe.Subscription.Status;
  teamId: string;
  customerId: string;
}): Stripe.Subscription {
  return {
    id,
    object: "subscription",
    status,
    customer: customerId,
    cancel_at_period_end: false,
    metadata: { teamId },
    items: {
      object: "list",
      data: [
        {
          id: "si_lifecycle",
          current_period_end: Math.floor((Date.now() + 14 * dayInMs) / 1000),
          price: { id: PAID_PRICE_ID, recurring: { interval: "month" } },
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

function resourceMissing(): Error {
  return Object.assign(new Error("No such subscription"), { code: "resource_missing" });
}

// Records every Stripe call so tests can assert on the idempotency key and cleanup calls.
interface FakeStripeCalls {
  created: Array<{ params: Stripe.SubscriptionCreateParams; idempotencyKey?: string }>;
  retrieved: string[];
  canceled: string[];
}

function makeFakeStripe(handlers: {
  create?: (params: Stripe.SubscriptionCreateParams) => Promise<Stripe.Subscription>;
  retrieve?: (id: string) => Promise<Stripe.Subscription>;
  cancel?: (id: string) => Promise<Stripe.Subscription>;
  setupIntent?: Stripe.SetupIntent;
}): { client: TrialSubscriptionStripe & { setupIntents: unknown }; calls: FakeStripeCalls } {
  const calls: FakeStripeCalls = { created: [], retrieved: [], canceled: [] };

  const client = {
    subscriptions: {
      create: async (params: Stripe.SubscriptionCreateParams, options: Stripe.RequestOptions) => {
        calls.created.push({ params, idempotencyKey: options?.idempotencyKey });
        if (!handlers.create) {
          throw new Error("unexpected subscriptions.create");
        }
        return handlers.create(params);
      },
      retrieve: async (id: string) => {
        calls.retrieved.push(id);
        if (!handlers.retrieve) {
          throw new Error("unexpected subscriptions.retrieve");
        }
        return handlers.retrieve(id);
      },
      cancel: async (id: string) => {
        calls.canceled.push(id);
        if (!handlers.cancel) {
          throw new Error("unexpected subscriptions.cancel");
        }
        return handlers.cancel(id);
      },
    },
    setupIntents: {
      retrieve: async () => {
        if (!handlers.setupIntent) {
          throw new Error("unexpected setupIntents.retrieve");
        }
        return handlers.setupIntent;
      },
    },
  };

  return { client, calls };
}

function makeSetupIntent({
  customerId,
  teamId,
  planId,
  interval,
  paymentMethodId = uid("pm"),
}: {
  customerId: string;
  teamId: string;
  planId: string;
  interval: string;
  paymentMethodId?: string;
}): Stripe.SetupIntent {
  return {
    id: uid("seti"),
    object: "setup_intent",
    status: "succeeded",
    customer: customerId,
    payment_method: paymentMethodId,
    metadata: { teamId, planId, interval },
  } as unknown as Stripe.SetupIntent;
}

async function findReservation(teamId: string, userId: string) {
  const [row] = await db
    .select()
    .from(teamTrialReservationTable)
    .where(and(
      eq(teamTrialReservationTable.teamId, teamId),
      eq(teamTrialReservationTable.userId, userId),
    ));
  return row;
}

beforeEach(async () => {
  stripeState.client = null;
  await clearRows();
});

// ----- completeTrialSubscription -----

test.skipIf(!HAS_TRIAL_PLAN)("completeTrialSubscription releases the reservation on success and stamps user + team", async () => {
  const customerId = uid("cus");
  const { teamId, userId } = await seedTeamAndUser({ customerId });
  const subId = uid("sub");

  const { client } = makeFakeStripe({
    setupIntent: makeSetupIntent({ customerId, teamId, planId: PAID_PLAN_ID, interval: "month" }),
    create: async () => makeSubscription({ id: subId, status: "trialing", teamId, customerId }),
  });
  stripeState.client = client;

  await completeTrialSubscription({
    teamId,
    userId,
    actingUserEmail: "owner@example.com",
    setupIntentId: "seti_x",
  });

  const reservation = await findReservation(teamId, userId);
  expect(reservation).toBeUndefined();

  const team = await db.query.teamTable.findFirst({ where: { id: teamId } });
  const user = await db.query.userTable.findFirst({ where: { id: userId } });
  expect(team?.trialUsedAt).toBeTruthy();
  expect(team?.stripeSubscriptionId).toBe(subId);
  expect(user?.trialUsedAt).toBeTruthy();
  // Both stamps set → the released reservation leaves the user/team ineligible.
  expect(await isTrialEligible({ teamId, userId })).toBe(false);
});

test.skipIf(!HAS_TRIAL_PLAN)("completeTrialSubscription RETAINS the reservation on an ambiguous Stripe failure", async () => {
  const customerId = uid("cus");
  const { teamId, userId } = await seedTeamAndUser({ customerId });

  const { client, calls } = makeFakeStripe({
    setupIntent: makeSetupIntent({ customerId, teamId, planId: PAID_PLAN_ID, interval: "month" }),
    // Connection errors are ambiguous — Stripe may have created the subscription.
    create: async () => {
      throw new Stripe.errors.StripeConnectionError({ message: "network blip" });
    },
  });
  stripeState.client = client;

  await expect(
    completeTrialSubscription({
      teamId,
      userId,
      actingUserEmail: "owner@example.com",
      setupIntentId: "seti_x",
    }),
  ).rejects.toBeInstanceOf(Stripe.errors.StripeConnectionError);

  const reservation = await findReservation(teamId, userId);
  expect(reservation).toBeDefined();
  // A recovery breadcrumb is stamped so the sweep can settle it later; the idempotency key
  // is derived from the retained reservation id.
  expect(reservation?.lastError).toBeTruthy();
  expect(calls.created[0]?.idempotencyKey).toBe(`team-trial:${reservation?.id}`);

  const team = await db.query.teamTable.findFirst({ where: { id: teamId } });
  const user = await db.query.userTable.findFirst({ where: { id: userId } });
  expect(team?.trialUsedAt).toBeFalsy();
  expect(user?.trialUsedAt).toBeFalsy();
  // The retained reservation keeps the team/user blocked from minting a second trial.
  expect(await isTrialEligible({ teamId, userId })).toBe(false);
});

// A rejected payment method gets a final refusal, so the client stops repeating the create call.
test.skipIf(!HAS_TRIAL_PLAN).each([
  ["a declined card", () => new Stripe.errors.StripeCardError({ message: "card declined" })],
  [
    "an unsupported payment method type",
    () => new Stripe.errors.StripeInvalidRequestError({ message: "unsupported", param: "default_payment_method" }),
  ],
] as const)("completeTrialSubscription RELEASES the reservation and refuses %s as final", async (_label, makeError) => {
  const customerId = uid("cus");
  const { teamId, userId } = await seedTeamAndUser({ customerId });

  const { client } = makeFakeStripe({
    setupIntent: makeSetupIntent({ customerId, teamId, planId: PAID_PLAN_ID, interval: "month" }),
    create: async () => {
      throw makeError();
    },
  });
  stripeState.client = client;

  await expect(
    completeTrialSubscription({
      teamId,
      userId,
      actingUserEmail: "owner@example.com",
      setupIntentId: "seti_x",
    }),
  ).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
    messageKey: "Client.Dashboard.Billing.errorTrialPaymentMethodUnsupported",
  });

  const reservation = await findReservation(teamId, userId);
  expect(reservation).toBeUndefined();
  // Nothing was created, so the user is eligible to retry with another payment method.
  expect(await isTrialEligible({ teamId, userId })).toBe(true);
});

// A definite failure of our own credentials is not the customer's fault: release, but rethrow as is.
test.skipIf(!HAS_TRIAL_PLAN)("completeTrialSubscription RELEASES the reservation and rethrows a credential failure", async () => {
  const customerId = uid("cus");
  const { teamId, userId } = await seedTeamAndUser({ customerId });

  const { client } = makeFakeStripe({
    setupIntent: makeSetupIntent({ customerId, teamId, planId: PAID_PLAN_ID, interval: "month" }),
    create: async () => {
      throw new Stripe.errors.StripeAuthenticationError({ message: "invalid api key" });
    },
  });
  stripeState.client = client;

  await expect(
    completeTrialSubscription({
      teamId,
      userId,
      actingUserEmail: "owner@example.com",
      setupIntentId: "seti_x",
    }),
  ).rejects.toBeInstanceOf(Stripe.errors.StripeAuthenticationError);

  expect(await findReservation(teamId, userId)).toBeUndefined();
  expect(await isTrialEligible({ teamId, userId })).toBe(true);
});

// The client sends only the SetupIntent id, so the metadata is the one source of the plan.
test.skipIf(!HAS_TRIAL_PLAN).each([
  ["no plan", { planId: undefined }],
  ["a plan that cannot be bought", { planId: "not-a-plan" }],
  ["no interval", { interval: undefined }],
  ["another team", { teamId: "team_other" }],
])("completeTrialSubscription refuses a SetupIntent whose metadata has %s", async (_label, override) => {
  const customerId = uid("cus");
  const { teamId, userId } = await seedTeamAndUser({ customerId });
  const setupIntent = makeSetupIntent({ customerId, teamId, planId: PAID_PLAN_ID, interval: "month" });
  setupIntent.metadata = { ...setupIntent.metadata, ...override } as Stripe.Metadata;

  const { client, calls } = makeFakeStripe({ setupIntent });
  stripeState.client = client;

  await expect(
    completeTrialSubscription({
      teamId,
      userId,
      actingUserEmail: "owner@example.com",
      setupIntentId: setupIntent.id,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

  expect(calls.created).toHaveLength(0);
  expect(await findReservation(teamId, userId)).toBeUndefined();
});

// The client keeps the return query only for the pending reason, so a failed card must not send it.
test.skipIf(!HAS_TRIAL_PLAN).each([
  ["processing", TRIAL_SETUP_PENDING_REASON],
  ["requires_payment_method", "Client.Dashboard.Billing.errorTrialUnavailable"],
] as const)("completeTrialSubscription refuses a %s SetupIntent with its own reason", async (status, messageKey) => {
  const customerId = uid("cus");
  const { teamId, userId } = await seedTeamAndUser({ customerId });
  const setupIntent = makeSetupIntent({ customerId, teamId, planId: PAID_PLAN_ID, interval: "month" });
  setupIntent.status = status;

  const { client, calls } = makeFakeStripe({ setupIntent });
  stripeState.client = client;

  await expect(
    completeTrialSubscription({
      teamId,
      userId,
      actingUserEmail: "owner@example.com",
      setupIntentId: setupIntent.id,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", messageKey });

  expect(calls.created).toHaveLength(0);
  expect(await findReservation(teamId, userId)).toBeUndefined();
  expect(await isTrialEligible({ teamId, userId })).toBe(true);
});

// ----- settleStaleTrialReservations (recovery sweep) -----

async function insertReservation({
  teamId,
  userId,
  customerId,
  stripeSubscriptionId = null,
  orphanedSubscriptionId = null,
  lastRecoveryAt = null,
}: {
  teamId: string;
  userId: string;
  customerId: string;
  stripeSubscriptionId?: string | null;
  orphanedSubscriptionId?: string | null;
  lastRecoveryAt?: Date | null;
}): Promise<void> {
  await db.insert(teamTrialReservationTable).values({
    userId,
    teamId,
    setupIntentId: uid("seti"),
    planId: PAID_PLAN_ID,
    interval: "month",
    customerId,
    paymentMethodId: uid("pm"),
    priceId: PAID_PRICE_ID,
    trialDays: 14,
    stripeSubscriptionId,
    orphanedSubscriptionId,
    lastRecoveryAt,
  });
}

test("recovery finalizes a stale reservation whose recorded subscription is trialing", async () => {
  const customerId = uid("cus");
  const { teamId, userId } = await seedTeamAndUser({ customerId });
  const subId = uid("sub");
  await insertReservation({ teamId, userId, customerId, stripeSubscriptionId: subId });

  const { client, calls } = makeFakeStripe({
    retrieve: async (id) => makeSubscription({ id, status: "trialing", teamId, customerId }),
  });

  // `now` is pushed an hour ahead so the freshly-inserted row is past the stale window.
  const settled = await settleStaleTrialReservations({
    now: new Date(Date.now() + HOUR_MS),
    stripe: client,
  });

  expect(settled).toBe(1);
  expect(calls.retrieved).toEqual([subId]);
  expect(await findReservation(teamId, userId)).toBeUndefined();
  const team = await db.query.teamTable.findFirst({ where: { id: teamId } });
  const user = await db.query.userTable.findFirst({ where: { id: userId } });
  expect(team?.trialUsedAt).toBeTruthy();
  expect(user?.trialUsedAt).toBeTruthy();
});

test("recovery releases a stale reservation whose recorded subscription no longer exists", async () => {
  const customerId = uid("cus");
  const { teamId, userId } = await seedTeamAndUser({ customerId });
  await insertReservation({ teamId, userId, customerId, stripeSubscriptionId: uid("sub") });

  const { client } = makeFakeStripe({
    retrieve: async () => {
      throw resourceMissing();
    },
  });

  const settled = await settleStaleTrialReservations({
    now: new Date(Date.now() + HOUR_MS),
    stripe: client,
  });

  expect(settled).toBe(1);
  expect(await findReservation(teamId, userId)).toBeUndefined();
  // Nothing was granted, so the user stays eligible.
  expect(await isTrialEligible({ teamId, userId })).toBe(true);
});

test("recovery re-drives creation (same idempotency key) for a reservation with no recorded subscription", async () => {
  const customerId = uid("cus");
  const { teamId, userId } = await seedTeamAndUser({ customerId });
  await insertReservation({ teamId, userId, customerId, stripeSubscriptionId: null });
  const reservation = await findReservation(teamId, userId);
  const subId = uid("sub");

  const { client, calls } = makeFakeStripe({
    create: async () => makeSubscription({ id: subId, status: "trialing", teamId, customerId }),
  });

  const settled = await settleStaleTrialReservations({
    now: new Date(Date.now() + HOUR_MS),
    stripe: client,
  });

  expect(settled).toBe(1);
  expect(calls.created[0]?.idempotencyKey).toBe(`team-trial:${reservation?.id}`);
  expect(await findReservation(teamId, userId)).toBeUndefined();
  const team = await db.query.teamTable.findFirst({ where: { id: teamId } });
  expect(team?.trialUsedAt).toBeTruthy();
});

test("recovery releases when a re-driven creation is definitely rejected", async () => {
  const customerId = uid("cus");
  const { teamId, userId } = await seedTeamAndUser({ customerId });
  await insertReservation({ teamId, userId, customerId, stripeSubscriptionId: null });

  const { client } = makeFakeStripe({
    create: async () => {
      throw new Stripe.errors.StripeInvalidRequestError({ message: "payment method detached" });
    },
  });

  const settled = await settleStaleTrialReservations({
    now: new Date(Date.now() + HOUR_MS),
    stripe: client,
  });

  expect(settled).toBe(1);
  expect(await findReservation(teamId, userId)).toBeUndefined();
  expect(await isTrialEligible({ teamId, userId })).toBe(true);
});

test("recovery cancels a recorded race-loser orphan before settling", async () => {
  const customerId = uid("cus");
  const { teamId, userId } = await seedTeamAndUser({ customerId });
  const subId = uid("sub");
  const orphanId = uid("orphan");
  await insertReservation({
    teamId,
    userId,
    customerId,
    stripeSubscriptionId: subId,
    orphanedSubscriptionId: orphanId,
  });

  const { client, calls } = makeFakeStripe({
    retrieve: async (id) => makeSubscription({ id, status: "trialing", teamId, customerId }),
    cancel: async (id) => makeSubscription({ id, status: "canceled", teamId, customerId }),
  });

  await settleStaleTrialReservations({ now: new Date(Date.now() + HOUR_MS), stripe: client });

  expect(calls.canceled).toEqual([orphanId]);
  expect(await findReservation(teamId, userId)).toBeUndefined();
});

test("the sweep skips reservations younger than the stale window", async () => {
  const customerId = uid("cus");
  const { teamId, userId } = await seedTeamAndUser({ customerId });
  await insertReservation({ teamId, userId, customerId, stripeSubscriptionId: uid("sub") });

  const { client, calls } = makeFakeStripe({});

  // A current `now`: the just-inserted row is inside the stale window and must be skipped.
  const settled = await settleStaleTrialReservations({ now: new Date(), stripe: client });

  expect(settled).toBe(0);
  expect(calls.retrieved).toEqual([]);
  expect(await findReservation(teamId, userId)).toBeDefined();
});

test("the sweep does not re-drive a reservation recovered within the retry interval", async () => {
  const customerId = uid("cus");
  const { teamId, userId } = await seedTeamAndUser({ customerId });
  await insertReservation({
    teamId,
    userId,
    customerId,
    stripeSubscriptionId: null,
    lastRecoveryAt: new Date(Date.now() + HOUR_MS - 60_000),
  });

  const { client, calls } = makeFakeStripe({});

  const settled = await settleStaleTrialReservations({
    now: new Date(Date.now() + HOUR_MS),
    stripe: client,
  });

  expect(settled).toBe(0);
  expect(calls.created).toEqual([]);
  expect(await findReservation(teamId, userId)).toBeDefined();
});
