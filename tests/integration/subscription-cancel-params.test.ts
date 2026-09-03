/// <reference types="@cloudflare/vitest-plugin/types" />

// Cancelling with both Stripe flags at their `false` defaults DELETES pending prorations — money
// the customer already owes for units they already used. These tests pin which call sites pass
// the flags and which deliberately do not, so a later "consistency fix" cannot sweep the two
// together: the race and orphan cleanups cancel an `incomplete` subscription the customer never
// used, and invoicing one would bill them for something that never existed.

import { beforeEach, expect, test, vi } from "vitest";

const { stripeState } = vi.hoisted(() => ({
  stripeState: { cancelCalls: [] as { id: string; params: unknown }[] },
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: async () => ({
    subscriptions: {
      retrieve: async (id: string) => makeSubscription({ id, status: retrieveStatus.current }),
      cancel: async (id: string, params?: unknown) => {
        stripeState.cancelCalls.push({ id, params });

        return makeSubscription({ id, status: "canceled" });
      },
    },
  }),
}));

import { env } from "cloudflare:workers";
import type Stripe from "stripe";

import { getDB } from "@/db";
import { teamTable } from "@/db/schema";
import { DEFAULT_PLAN_ID } from "@/constants/plans";
import { settleRecordedSubscription } from "@/utils/team-subscription";

const db = getDB();
const retrieveStatus = { current: "incomplete" as Stripe.Subscription.Status };

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

function makeSubscription({
  id,
  status,
}: {
  id: string;
  status: Stripe.Subscription.Status;
}): Stripe.Subscription {
  return {
    id,
    object: "subscription",
    status,
    customer: `cus_${id}`,
    metadata: {},
    items: { data: [] },
    cancel_at_period_end: false,
  } as unknown as Stripe.Subscription;
}

async function seedTeamWithSubscription(subscriptionId: string): Promise<string> {
  const teamId = uid("team");

  await db.insert(teamTable).values({
    id: teamId,
    name: "Acme",
    slug: teamId,
    subscriptionPlanId: DEFAULT_PLAN_ID,
    stripeCustomerId: `cus_${subscriptionId}`,
    stripeSubscriptionId: subscriptionId,
  });

  return teamId;
}

beforeEach(async () => {
  await env.D1_DB.prepare("DELETE FROM team").run();
  stripeState.cancelCalls = [];
});

test.each([
  // Nothing was ever collected on an incomplete subscription, so there is nothing owed.
  ["incomplete", false],
  // These two ran, so either can carry prorations or metered usage that is owed to us.
  ["unpaid", true],
  ["paused", true],
] as const)(
  "settleRecordedSubscription invoices a %s subscription on cancel: %s",
  async (status, invoiceNow) => {
    retrieveStatus.current = status;
    const subscriptionId = uid("sub");
    const teamId = await seedTeamWithSubscription(subscriptionId);

    await settleRecordedSubscription({ teamId, recordedSubscriptionId: subscriptionId });

    expect(stripeState.cancelCalls).toHaveLength(1);
    expect(stripeState.cancelCalls[0]?.params).toEqual({
      invoice_now: invoiceNow,
      // Never true on any path: crediting unused time is a pricing policy change, not a bug fix.
      prorate: false,
    });
  },
);

test("a status that grants paid access is refused rather than cancelled", async () => {
  retrieveStatus.current = "active";
  const subscriptionId = uid("sub");
  const teamId = await seedTeamWithSubscription(subscriptionId);

  await expect(settleRecordedSubscription({ teamId, recordedSubscriptionId: subscriptionId }))
    .rejects.toThrow();
  expect(stripeState.cancelCalls).toHaveLength(0);
});
