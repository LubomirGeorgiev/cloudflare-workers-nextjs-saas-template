/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import type Stripe from "stripe";

import { getDB } from "@/db";
import { teamTable, teamMembershipTable, userTable, SYSTEM_ROLES_ENUM } from "@/db/schema";
import { handleStripeEvent, type StripeSubscriptionFetcher } from "@/utils/stripe-webhook-handler";
import { CURRENT_SESSION_VERSION, type KVSession } from "@/utils/kv-session";
import { claimTeamSubscription, isTrialEligible, markUserTrialUsed } from "@/utils/team-subscription";
import { DEFAULT_PLAN_ID, PAID_PLAN_IDS, type TeamPlanId } from "@/constants/plans";
import { runScheduledJob } from "@/lib/scheduler/job-handlers";
import { SCHEDULED_JOB_TYPES } from "@/lib/scheduler/jobs";

const db = getDB();
const dayInMs = 24 * 60 * 60 * 1000;

// Template-safe: derive the plan under test from the catalog instead of assuming a
// plan named "pro", so downstream projects that rename plans keep passing.
const PAID_PLAN_ID = PAID_PLAN_IDS[0];
const PAID_PRICE_ID = `price_${PAID_PLAN_ID}_integration`;
const PAID_YEAR_PRICE_ID = `price_${PAID_PLAN_ID}_year_integration`;

// planIdFromPriceId resolves the synthetic prices back to the paid plan.
process.env[`STRIPE_PRICE_${PAID_PLAN_ID.toUpperCase()}`] = PAID_PRICE_ID;
process.env[`STRIPE_PRICE_${PAID_PLAN_ID.toUpperCase()}_YEAR`] = PAID_YEAR_PRICE_ID;

async function clearRows(): Promise<void> {
  await env.D1_DB.batch([
    env.D1_DB.prepare("DELETE FROM team_membership"),
    env.D1_DB.prepare("DELETE FROM team"),
    env.D1_DB.prepare("DELETE FROM user"),
  ]);
  const keys = await env.KV_STORE.list();
  await Promise.all(keys.keys.map((key) => env.KV_STORE.delete(key.name)));
}

async function seedTeam({ id, planId = DEFAULT_PLAN_ID }: { id: string; planId?: TeamPlanId }): Promise<void> {
  await db.insert(teamTable).values({ id, name: "Acme", slug: id, subscriptionPlanId: planId });
}

async function seedMember({ teamId, userId }: { teamId: string; userId: string }): Promise<void> {
  await db.insert(userTable).values({ id: userId, email: `${userId}@example.com` });
  await db.insert(teamMembershipTable).values({
    id: `tmem_${userId}`,
    teamId,
    userId,
    roleId: SYSTEM_ROLES_ENUM.OWNER,
    isSystemRole: 1,
    isActive: 1,
  });
}

async function seedSession({ userId }: { userId: string }): Promise<string> {
  const user = await db.query.userTable.findFirst({ where: { id: userId } });
  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  const expiresAt = new Date(Date.now() + 30 * dayInMs);
  const session: KVSession = {
    id: "session-1",
    userId,
    expiresAt: expiresAt.getTime(),
    createdAt: Date.now(),
    user,
    teams: [],
    version: CURRENT_SESSION_VERSION,
  };
  const key = `session:${userId}:session-1`;
  await env.KV_STORE.put(key, JSON.stringify(session), {
    expirationTtl: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  });
  return key;
}

function makeSubscription({
  id = "sub_test",
  status,
  teamId,
  priceId = PAID_PRICE_ID,
  interval = "month",
  periodEndSeconds = Math.floor((Date.now() + 30 * dayInMs) / 1000),
  cancelAtPeriodEnd = false,
}: {
  id?: string;
  status: Stripe.Subscription.Status;
  teamId: string;
  priceId?: string;
  interval?: "month" | "year";
  periodEndSeconds?: number;
  cancelAtPeriodEnd?: boolean;
}): Stripe.Subscription {
  return {
    id,
    object: "subscription",
    status,
    customer: "cus_test",
    cancel_at_period_end: cancelAtPeriodEnd,
    metadata: { teamId },
    items: {
      object: "list",
      data: [
        {
          id: "si_test",
          current_period_end: periodEndSeconds,
          price: { id: priceId, recurring: { interval } },
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

function makeSubscriptionEvent(
  type: string,
  subscription: Stripe.Subscription,
): Stripe.Event {
  return { type, data: { object: subscription } } as unknown as Stripe.Event;
}

function makeInvoiceEvent(type: string, subscriptionId: string): Stripe.Event {
  return {
    type,
    data: {
      object: {
        object: "invoice",
        parent: { subscription_details: { subscription: subscriptionId } },
      },
    },
  } as unknown as Stripe.Event;
}

// A fake Stripe client that always returns the given subscription snapshot on retrieve.
function fakeStripe(subscription: Stripe.Subscription): StripeSubscriptionFetcher {
  return {
    subscriptions: {
      retrieve: async () => subscription,
    },
  };
}

// A fake Stripe client that fails the test if the handler fetches at all.
function rejectingStripe(): StripeSubscriptionFetcher {
  return {
    subscriptions: {
      retrieve: async () => {
        throw new Error("unexpected Stripe fetch");
      },
    },
  };
}

async function getTeam(id: string) {
  return db.query.teamTable.findFirst({ where: { id } });
}

describe("Stripe subscription webhook handling", () => {
  beforeEach(async () => {
    await clearRows();
  });

  test("customer.subscription.created links the subscription and sets the plan", async () => {
    await seedTeam({ id: "team_a" });
    const subscription = makeSubscription({ status: "incomplete", teamId: "team_a" });

    await handleStripeEvent(
      makeSubscriptionEvent("customer.subscription.created", subscription),
      { stripe: fakeStripe(subscription) },
    );

    const team = await getTeam("team_a");
    expect(team?.stripeSubscriptionId).toBe("sub_test");
    expect(team?.subscriptionPlanId).toBe(PAID_PLAN_ID);
    expect(team?.subscriptionStatus).toBe("incomplete");
    expect(team?.subscriptionInterval).toBe("month");
    expect(team?.planExpiresAt).toBeTruthy();
  });

  test("a yearly-price subscription records the same plan with a yearly interval", async () => {
    await seedTeam({ id: "team_a" });
    const subscription = makeSubscription({
      status: "active",
      teamId: "team_a",
      priceId: PAID_YEAR_PRICE_ID,
      interval: "year",
    });

    await handleStripeEvent(
      makeSubscriptionEvent("customer.subscription.created", subscription),
      { stripe: fakeStripe(subscription) },
    );

    const team = await getTeam("team_a");
    // Monthly and yearly prices map to the same plan; only the interval differs.
    expect(team?.subscriptionPlanId).toBe(PAID_PLAN_ID);
    expect(team?.subscriptionInterval).toBe("year");
  });

  test("concurrent checkout claims converge on a single subscription", async () => {
    await seedTeam({ id: "team_a" });

    const [first, second] = await Promise.all([
      claimTeamSubscription({ teamId: "team_a", subscriptionId: "sub_first" }),
      claimTeamSubscription({ teamId: "team_a", subscriptionId: "sub_second" }),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);

    const winnerId = first ? "sub_first" : "sub_second";
    const team = await getTeam("team_a");
    expect(team?.stripeSubscriptionId).toBe(winnerId);

    // Re-claiming the winning subscription (e.g. after its webhook landed) still wins.
    expect(await claimTeamSubscription({ teamId: "team_a", subscriptionId: winnerId })).toBe(true);
  });

  test("a webhook for a lost concurrent checkout cannot steal the claimed slot", async () => {
    await seedTeam({ id: "team_a" });
    expect(await claimTeamSubscription({ teamId: "team_a", subscriptionId: "sub_winner" })).toBe(true);

    const loser = makeSubscription({ id: "sub_loser", status: "incomplete", teamId: "team_a" });
    await handleStripeEvent(
      makeSubscriptionEvent("customer.subscription.created", loser),
      { stripe: fakeStripe(loser) },
    );

    const team = await getTeam("team_a");
    expect(team?.stripeSubscriptionId).toBe("sub_winner");
  });

  test("a trialing subscription grants the paid plan and stamps the team's one-time trial", async () => {
    await seedTeam({ id: "team_a" });
    const subscription = makeSubscription({ status: "trialing", teamId: "team_a" });

    await handleStripeEvent(
      makeSubscriptionEvent("customer.subscription.created", subscription),
      { stripe: fakeStripe(subscription) },
    );

    const team = await getTeam("team_a");
    expect(team?.subscriptionPlanId).toBe(PAID_PLAN_ID);
    expect(team?.subscriptionStatus).toBe("trialing");
    // Trial end mirrors the item period end so the UI can show "trial ends on".
    expect(team?.planExpiresAt).toBeTruthy();
    expect(team?.trialUsedAt).toBeTruthy();
  });

  test("the trial stamp survives later lifecycle events and replays", async () => {
    await seedTeam({ id: "team_a" });
    const trialing = makeSubscription({ status: "trialing", teamId: "team_a" });
    await handleStripeEvent(
      makeSubscriptionEvent("customer.subscription.created", trialing),
      { stripe: fakeStripe(trialing) },
    );
    const stampedAt = (await getTeam("team_a"))?.trialUsedAt;
    expect(stampedAt).toBeTruthy();

    // Replaying the trialing snapshot must not re-stamp; trial end → active and a later
    // cancellation must not clear the stamp (one free trial per team, ever).
    await handleStripeEvent(
      makeSubscriptionEvent("customer.subscription.updated", trialing),
      { stripe: fakeStripe(trialing) },
    );
    expect((await getTeam("team_a"))?.trialUsedAt?.getTime()).toBe(stampedAt?.getTime());

    const active = makeSubscription({ status: "active", teamId: "team_a" });
    await handleStripeEvent(
      makeSubscriptionEvent("customer.subscription.updated", active),
      { stripe: fakeStripe(active) },
    );
    const canceled = makeSubscription({ status: "canceled", teamId: "team_a" });
    await handleStripeEvent(
      makeSubscriptionEvent("customer.subscription.deleted", canceled),
      { stripe: fakeStripe(canceled) },
    );

    const team = await getTeam("team_a");
    expect(team?.subscriptionPlanId).toBe(DEFAULT_PLAN_ID);
    // Reverting to free clears the recorded billing interval too.
    expect(team?.subscriptionInterval).toBeNull();
    expect(team?.trialUsedAt?.getTime()).toBe(stampedAt?.getTime());
  });

  test("trial eligibility needs both an unstamped team and an unstamped user", async () => {
    await seedTeam({ id: "team_a" });
    await seedMember({ teamId: "team_a", userId: "usr_a" });
    expect(await isTrialEligible({ teamId: "team_a", userId: "usr_a" })).toBe(true);

    // A trialing subscription stamps the team; the same team never trials again.
    const trialing = makeSubscription({ status: "trialing", teamId: "team_a" });
    await handleStripeEvent(
      makeSubscriptionEvent("customer.subscription.created", trialing),
      { stripe: fakeStripe(trialing) },
    );
    expect(await isTrialEligible({ teamId: "team_a", userId: "usr_a" })).toBe(false);

    // A stamped user cannot farm a fresh trial by creating a brand-new team.
    await markUserTrialUsed("usr_a");
    await seedTeam({ id: "team_b" });
    expect(await isTrialEligible({ teamId: "team_b", userId: "usr_a" })).toBe(false);

    // markUserTrialUsed never overwrites the first trial's stamp.
    const firstStamp = (await db.query.userTable.findFirst({ where: { id: "usr_a" } }))?.trialUsedAt;
    await markUserTrialUsed("usr_a");
    const secondStamp = (await db.query.userTable.findFirst({ where: { id: "usr_a" } }))?.trialUsedAt;
    expect(secondStamp?.getTime()).toBe(firstStamp?.getTime());

    // An unstamped user on the fresh team is still eligible.
    await db.insert(userTable).values({ id: "usr_b", email: "usr_b@example.com" });
    expect(await isTrialEligible({ teamId: "team_b", userId: "usr_b" })).toBe(true);
  });

  test("customer.subscription.trial_will_end re-snapshots the subscription", async () => {
    await seedTeam({ id: "team_a" });
    const subscription = makeSubscription({ status: "trialing", teamId: "team_a" });

    await handleStripeEvent(
      makeSubscriptionEvent("customer.subscription.trial_will_end", subscription),
      { stripe: fakeStripe(subscription) },
    );

    const team = await getTeam("team_a");
    expect(team?.subscriptionStatus).toBe("trialing");
    expect(team?.subscriptionPlanId).toBe(PAID_PLAN_ID);
  });

  test("customer.subscription.updated to active flips the status", async () => {
    await seedTeam({ id: "team_a" });
    const subscription = makeSubscription({ status: "active", teamId: "team_a", cancelAtPeriodEnd: true });

    await handleStripeEvent(
      makeSubscriptionEvent("customer.subscription.updated", subscription),
      { stripe: fakeStripe(subscription) },
    );

    const team = await getTeam("team_a");
    expect(team?.subscriptionStatus).toBe("active");
    expect(team?.subscriptionPlanId).toBe(PAID_PLAN_ID);
    // A scheduled cancellation is persisted so billing reads never need a live fetch.
    expect(team?.cancelAtPeriodEnd).toBe(1);
  });

  test("customer.subscription.deleted reverts the team to free", async () => {
    await seedTeam({ id: "team_a", planId: PAID_PLAN_ID });
    const subscription = makeSubscription({ status: "canceled", teamId: "team_a" });

    await handleStripeEvent(
      makeSubscriptionEvent("customer.subscription.deleted", subscription),
      { stripe: fakeStripe(subscription) },
    );

    const team = await getTeam("team_a");
    expect(team?.subscriptionPlanId).toBe(DEFAULT_PLAN_ID);
    expect(team?.stripeSubscriptionId).toBeNull();
    expect(team?.subscriptionStatus).toBe("canceled");
    expect(team?.cancelAtPeriodEnd).toBe(0);
  });

  test("incomplete_expired (abandoned checkout) clears the subscription", async () => {
    await seedTeam({ id: "team_a", planId: PAID_PLAN_ID });
    await claimTeamSubscription({ teamId: "team_a", subscriptionId: "sub_test" });
    const subscription = makeSubscription({ status: "incomplete_expired", teamId: "team_a" });

    await handleStripeEvent(
      makeSubscriptionEvent("customer.subscription.updated", subscription),
      { stripe: fakeStripe(subscription) },
    );

    const team = await getTeam("team_a");
    expect(team?.subscriptionPlanId).toBe(DEFAULT_PLAN_ID);
    expect(team?.stripeSubscriptionId).toBeNull();
    expect(team?.subscriptionStatus).toBeNull();
  });

  test.each(["unpaid", "paused"] as const)(
    "%s reverts the team to Free but preserves the Stripe id for replacement cleanup",
    async (status) => {
      await seedTeam({ id: "team_a", planId: PAID_PLAN_ID });
      const subscription = makeSubscription({ status, teamId: "team_a" });

      await handleStripeEvent(
        makeSubscriptionEvent("customer.subscription.updated", subscription),
        { stripe: fakeStripe(subscription) },
      );

      const team = await getTeam("team_a");
      expect(team?.subscriptionPlanId).toBe(DEFAULT_PLAN_ID);
      expect(team?.stripeSubscriptionId).toBe("sub_test");
      expect(team?.subscriptionStatus).toBe(status);
      expect(team?.planExpiresAt).toBeNull();
    },
  );

  test("a terminal webhook for a previous subscription cannot detach its replacement", async () => {
    await seedTeam({ id: "team_a" });
    const replacement = makeSubscription({ id: "sub_replacement", status: "active", teamId: "team_a" });
    const canceled = makeSubscription({ id: "sub_previous", status: "canceled", teamId: "team_a" });

    await handleStripeEvent(
      makeSubscriptionEvent("customer.subscription.updated", replacement),
      { stripe: fakeStripe(replacement) },
    );
    await handleStripeEvent(
      makeSubscriptionEvent("customer.subscription.deleted", canceled),
      { stripe: fakeStripe(canceled) },
    );

    const team = await getTeam("team_a");
    expect(team?.subscriptionPlanId).toBe(PAID_PLAN_ID);
    expect(team?.stripeSubscriptionId).toBe("sub_replacement");
    expect(team?.subscriptionStatus).toBe("active");
  });

  test("invoice.paid recovers a past_due team to active", async () => {
    await seedTeam({ id: "team_a", planId: PAID_PLAN_ID });
    const pastDue = makeSubscription({ status: "past_due", teamId: "team_a" });
    await handleStripeEvent(makeInvoiceEvent("invoice.payment_failed", "sub_test"), {
      stripe: fakeStripe(pastDue),
    });

    const recovered = makeSubscription({ status: "active", teamId: "team_a" });
    await handleStripeEvent(makeInvoiceEvent("invoice.paid", "sub_test"), {
      stripe: fakeStripe(recovered),
    });

    const team = await getTeam("team_a");
    expect(team?.subscriptionStatus).toBe("active");
    expect(team?.subscriptionPlanId).toBe(PAID_PLAN_ID);
  });

  test("invoice.payment_action_required snapshots the SCA-pending status", async () => {
    await seedTeam({ id: "team_a", planId: PAID_PLAN_ID });
    const subscription = makeSubscription({ status: "incomplete", teamId: "team_a" });

    await handleStripeEvent(makeInvoiceEvent("invoice.payment_action_required", "sub_test"), {
      stripe: fakeStripe(subscription),
    });

    const team = await getTeam("team_a");
    expect(team?.subscriptionStatus).toBe("incomplete");
  });

  test("unhandled event types are ignored without fetching from Stripe", async () => {
    await seedTeam({ id: "team_a" });
    const subscription = makeSubscription({ status: "active", teamId: "team_a" });

    await expect(handleStripeEvent(
      makeSubscriptionEvent("customer.created", subscription),
      { stripe: rejectingStripe() },
    )).resolves.toBeUndefined();

    const team = await getTeam("team_a");
    expect(team?.stripeSubscriptionId).toBeNull();
  });

  test("handled events with no resolvable subscription are ignored", async () => {
    const event = {
      type: "invoice.paid",
      data: { object: { object: "invoice" } },
    } as unknown as Stripe.Event;

    await expect(handleStripeEvent(event, { stripe: rejectingStripe() }))
      .resolves.toBeUndefined();
  });

  test("a subscription for a vanished team resolves without throwing", async () => {
    // No team rows exist at all: metadata teamId and customer both resolve to nothing.
    const subscription = makeSubscription({ status: "active", teamId: "team_missing" });

    await expect(handleStripeEvent(
      makeSubscriptionEvent("customer.subscription.updated", subscription),
      { stripe: fakeStripe(subscription) },
    )).resolves.toBeUndefined();
  });

  test("invoice.payment_failed marks the team past_due", async () => {
    await seedTeam({ id: "team_a", planId: PAID_PLAN_ID });
    const subscription = makeSubscription({ status: "past_due", teamId: "team_a" });

    await handleStripeEvent(makeInvoiceEvent("invoice.payment_failed", "sub_test"), {
      stripe: fakeStripe(subscription),
    });

    const team = await getTeam("team_a");
    expect(team?.subscriptionStatus).toBe("past_due");
  });

  test("replaying the same event is idempotent", async () => {
    await seedTeam({ id: "team_a" });
    const subscription = makeSubscription({ status: "active", teamId: "team_a" });
    const event = makeSubscriptionEvent("customer.subscription.updated", subscription);

    await handleStripeEvent(event, { stripe: fakeStripe(subscription) });
    const first = await getTeam("team_a");

    await handleStripeEvent(event, { stripe: fakeStripe(subscription) });
    const second = await getTeam("team_a");

    expect(second?.subscriptionPlanId).toBe(first?.subscriptionPlanId);
    expect(second?.subscriptionStatus).toBe(first?.subscriptionStatus);
    expect(second?.stripeSubscriptionId).toBe(first?.stripeSubscriptionId);
  });

  test("the queued sessions-refresh job updates member sessions with the new plan", async () => {
    await seedTeam({ id: "team_a" });
    await seedMember({ teamId: "team_a", userId: "usr_member" });
    const sessionKey = await seedSession({ userId: "usr_member" });

    const subscription = makeSubscription({ status: "active", teamId: "team_a" });
    await handleStripeEvent(
      makeSubscriptionEvent("customer.subscription.updated", subscription),
      { stripe: fakeStripe(subscription) },
    );

    // The webhook only enqueues the refresh; the stored session is untouched until
    // the scheduler job runs.
    const beforeJob = JSON.parse(await env.KV_STORE.get(sessionKey) as string) as KVSession;
    expect(beforeJob.teams).toHaveLength(0);

    await runScheduledJob({
      type: SCHEDULED_JOB_TYPES.TEAM_SESSIONS_REFRESH,
      payload: { teamId: "team_a" },
      runAt: new Date().toISOString(),
    });

    const stored = await env.KV_STORE.get(sessionKey);
    expect(stored).toBeTruthy();
    const session = JSON.parse(stored as string) as KVSession;
    const team = session.teams?.find((t) => t.id === "team_a");
    expect(team?.planId).toBe(PAID_PLAN_ID);
    expect(team?.subscriptionStatus).toBe("active");
  });
});
