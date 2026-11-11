/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type Stripe from "stripe";

const { queueSendMock, ownerReadFailures } = vi.hoisted(() => ({
  queueSendMock: vi.fn(),
  // How many owner reads must reject before the real one runs again.
  ownerReadFailures: { count: 0 },
}));

vi.mock("@/lib/teams/team-owners", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/teams/team-owners")>();

  return {
    ...original,
    listTeamOwnerRecipients: async (...args: Parameters<typeof original.listTeamOwnerRecipients>) => {
      if (ownerReadFailures.count > 0) {
        ownerReadFailures.count -= 1;
        throw new Error("D1 is unreachable");
      }

      return original.listTeamOwnerRecipients(...args);
    },
  };
});

vi.mock("@/utils/is-local", () => ({ isLocalMode: false }));

// The email path goes through `getCloudflareContext`, so swapping only the queue binding leaves
// D1 and KV real while every queued email is captured.
vi.mock("@/utils/cloudflare-context", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/utils/cloudflare-context")>();

  return {
    ...original,
    getCloudflareContext: async () => {
      const context = await original.getCloudflareContext();

      return { ...context, env: { ...context.env, SCHEDULER_QUEUE: { send: queueSendMock } } };
    },
  };
});

import { SYSTEM_ROLES_ENUM } from "@/constants/team-roles";
import { PAID_PLAN_IDS } from "@/constants/plans";
import { getDB } from "@/db";
import { teamMembershipTable, teamTable, userTable } from "@/db/schema";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/config";
import { EMAIL_TEMPLATE_TYPES, SCHEDULED_JOB_TYPES } from "@/lib/scheduler/jobs";
import { handleStripeEvent, type StripeSubscriptionFetcher } from "@/utils/stripe-webhook-handler";
import { claimTeamSubscription } from "@/utils/team-subscription";

const db = getDB();
const TEAM_ID = "team_pay";
const SUBSCRIPTION_ID = "sub_pay";
const PAID_PLAN_ID = PAID_PLAN_IDS[0];
const PAID_PRICE_ID = `price_${PAID_PLAN_ID}_payment_notice`;
// A locale other than the default, when the catalog has one, so the test proves the owner's choice wins.
const OWNER_LOCALE: Locale = LOCALES.find((locale) => locale !== DEFAULT_LOCALE) ?? DEFAULT_LOCALE;

process.env[`STRIPE_PRICE_${PAID_PLAN_ID.toUpperCase()}`] = PAID_PRICE_ID;

async function clearRows(): Promise<void> {
  await env.D1_DB.batch([
    env.D1_DB.prepare("DELETE FROM team_membership"),
    env.D1_DB.prepare("DELETE FROM team"),
    env.D1_DB.prepare("DELETE FROM user"),
  ]);
}

async function seedMember({
  userId,
  roleId,
  isActive = 1,
  preferredLocale = null,
}: {
  userId: string;
  roleId: string;
  isActive?: number;
  preferredLocale?: Locale | null;
}): Promise<void> {
  await db.insert(userTable).values({ id: userId, email: `${userId}@example.com`, firstName: userId, preferredLocale });
  await db.insert(teamMembershipTable).values({
    id: `tmem_${userId}`,
    teamId: TEAM_ID,
    userId,
    roleId,
    isSystemRole: 1,
    isActive,
  });
}

// Two active owners get the notice. A plain member and a removed owner do not.
async function seedTeam(): Promise<void> {
  await db.insert(teamTable).values({ id: TEAM_ID, name: "Acme", slug: TEAM_ID, subscriptionPlanId: PAID_PLAN_ID });
  await claimTeamSubscription({ teamId: TEAM_ID, subscriptionId: SUBSCRIPTION_ID });
  await seedMember({ userId: "owner_a", roleId: SYSTEM_ROLES_ENUM.OWNER });
  await seedMember({ userId: "owner_b", roleId: SYSTEM_ROLES_ENUM.OWNER, preferredLocale: OWNER_LOCALE });
  await seedMember({ userId: "member_c", roleId: SYSTEM_ROLES_ENUM.MEMBER });
  await seedMember({ userId: "owner_d", roleId: SYSTEM_ROLES_ENUM.OWNER, isActive: 0 });
}

function makeSubscription({
  id = SUBSCRIPTION_ID,
  status,
}: {
  id?: string;
  status: Stripe.Subscription.Status;
}): Stripe.Subscription {
  return {
    id,
    object: "subscription",
    status,
    customer: "cus_pay",
    cancel_at_period_end: false,
    metadata: { teamId: TEAM_ID },
    items: {
      object: "list",
      data: [{
        id: "si_pay",
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        price: { id: PAID_PRICE_ID, recurring: { interval: "month" } },
      }],
    },
  } as unknown as Stripe.Subscription;
}

async function deliver({ status, id }: { status: Stripe.Subscription.Status; id?: string }): Promise<void> {
  const subscription = makeSubscription({ status, id });
  const stripe: StripeSubscriptionFetcher = { subscriptions: { retrieve: async () => subscription } };
  const event = { type: "customer.subscription.updated", data: { object: subscription } } as unknown as Stripe.Event;

  await handleStripeEvent(event, { stripe });
}

function queuedEmails() {
  return queueSendMock.mock.calls
    .map(([message]) => message as { type: string; payload: { to: string; template: string; locale?: string } })
    .filter((message) => message.type === SCHEDULED_JOB_TYPES.EMAIL_SEND)
    .map((message) => message.payload);
}

describe("payment status emails", () => {
  beforeEach(async () => {
    await clearRows();
    queueSendMock.mockReset();
    ownerReadFailures.count = 0;
    await seedTeam();
    await deliver({ status: "active" });
  });

  test("past_due emails every active owner once, in the owner's language", async () => {
    await deliver({ status: "past_due" });

    const emails = queuedEmails();
    expect(emails.map((email) => email.to).toSorted()).toEqual(["owner_a@example.com", "owner_b@example.com"]);
    expect(emails.every((email) => email.template === EMAIL_TEMPLATE_TYPES.PAYMENT_PAST_DUE)).toBe(true);
    expect(emails.find((email) => email.to === "owner_b@example.com")?.locale).toBe(OWNER_LOCALE);
    expect(emails.find((email) => email.to === "owner_a@example.com")?.locale).toBe(DEFAULT_LOCALE);
  });

  // The status write decides one send, so a replayed or a repeated webhook sends nothing.
  test("a replay of the same status sends nothing", async () => {
    await deliver({ status: "past_due" });
    queueSendMock.mockReset();

    await deliver({ status: "past_due" });

    expect(queuedEmails()).toEqual([]);
  });

  // At most once: the snapshot write is the claim, so a failure after it loses that notice.
  describe("a failure after the snapshot write", () => {
    async function expectPastDueSnapshot(): Promise<void> {
      const team = await db.query.teamTable.findFirst({ where: { id: TEAM_ID } });
      expect(team?.subscriptionStatus).toBe("past_due");
      expect(team?.subscriptionPlanId).toBe(PAID_PLAN_ID);
      expect(team?.stripeSubscriptionId).toBe(SUBSCRIPTION_ID);
    }

    function notifyLines(log: { mock: { calls: unknown[][] } }): string[] {
      return log.mock.calls.map(([text]) => String(text)).filter((text) => text.startsWith("notifyPaymentStatusChange"));
    }

    test("a failed owner read leaves a correct snapshot, logs one line, and a replay sends nothing", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      ownerReadFailures.count = 1;

      await deliver({ status: "past_due" });

      await expectPastDueSnapshot();
      expect(queuedEmails()).toEqual([]);
      expect(notifyLines(log)).toHaveLength(1);

      await deliver({ status: "past_due" });
      expect(queuedEmails()).toEqual([]);
      log.mockRestore();
    });

    test("a failed enqueue leaves a correct snapshot, logs one line, and the other owner still gets mail", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      queueSendMock.mockRejectedValueOnce(new Error("Queue is unavailable"));

      await deliver({ status: "past_due" });

      await expectPastDueSnapshot();
      expect(notifyLines(log)).toHaveLength(1);
      // Both owners were tried; only the first send rejected.
      expect(queuedEmails()).toHaveLength(2);
      log.mockRestore();
    });
  });

  test("unpaid sends the unpaid notice, and a later failure after recovery sends again", async () => {
    await deliver({ status: "past_due" });
    await deliver({ status: "unpaid" });
    const unpaid = queuedEmails().filter((email) => email.template === EMAIL_TEMPLATE_TYPES.PAYMENT_UNPAID);
    expect(unpaid).toHaveLength(2);

    await deliver({ status: "active" });
    queueSendMock.mockReset();
    await deliver({ status: "past_due" });

    expect(queuedEmails()).toHaveLength(2);
  });

  test("active and other statuses send nothing", async () => {
    await deliver({ status: "trialing" });
    await deliver({ status: "active" });

    expect(queuedEmails()).toEqual([]);
  });

  // A late webhook of a replaced subscription must not email the owners of the team.
  test("a past_due webhook for another subscription sends nothing", async () => {
    await deliver({ status: "past_due", id: "sub_replaced" });

    expect(queuedEmails()).toEqual([]);
    expect((await db.query.teamTable.findFirst({ where: { id: TEAM_ID } }))?.subscriptionStatus).toBe("active");
  });
});
