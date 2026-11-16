/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type Stripe from "stripe";

const { queueSendMock } = vi.hoisted(() => ({
  queueSendMock: vi.fn(),
}));

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

import { EU_WITHDRAWAL_ENABLED } from "@/constants";
import { SUBSCRIPTION_WITHDRAWAL_METADATA } from "@/constants/eu-withdrawal";
import { SYSTEM_ROLES_ENUM } from "@/constants/team-roles";
import { PAID_PLAN_IDS, TEAM_PLANS } from "@/constants/plans";
import { getDB } from "@/db";
import { teamMembershipTable, teamTable, userTable } from "@/db/schema";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/config";
import { buildCheckoutConsentMetadata, selectWithdrawalWindowEnd } from "@/lib/billing/eu-withdrawal-selectors";
import { EMAIL_TEMPLATE_TYPES, SCHEDULED_JOB_TYPES, type EmailSendJobPayload } from "@/lib/scheduler/jobs";
import { handleStripeEvent, type StripeSubscriptionFetcher } from "@/utils/stripe-webhook-handler";
import { claimTeamSubscription } from "@/utils/team-subscription";

const db = getDB();
const TEAM_ID = "team_order";
const SUBSCRIPTION_ID = "sub_order";
const PAID_PLAN_ID = PAID_PLAN_IDS[0];
const PAID_PRICE_ID = `price_${PAID_PLAN_ID}_order_confirmation`;
const STARTED_AT = new Date("2026-03-01T09:30:00.000Z");
const CONSENT_AT = new Date("2026-03-01T09:29:00.000Z");
// A locale other than the default, when the catalog has one, so the test proves the buyer's choice wins.
const BUYER_LOCALE: Locale = LOCALES.find((locale) => locale !== DEFAULT_LOCALE) ?? DEFAULT_LOCALE;

process.env[`STRIPE_PRICE_${PAID_PLAN_ID.toUpperCase()}`] = PAID_PRICE_ID;

type OrderConfirmationPayload = Extract<EmailSendJobPayload, { template: typeof EMAIL_TEMPLATE_TYPES.ORDER_CONFIRMATION }>;

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
  preferredLocale = null,
}: {
  userId: string;
  roleId: string;
  preferredLocale?: Locale | null;
}): Promise<void> {
  await db.insert(userTable).values({ id: userId, email: `${userId}@example.com`, firstName: userId, preferredLocale });
  await db.insert(teamMembershipTable).values({
    id: `tmem_${userId}`,
    teamId: TEAM_ID,
    userId,
    roleId,
    isSystemRole: 1,
    isActive: 1,
  });
}

// Two owners, and a member with billing access who did the checkout.
async function seedTeam(): Promise<void> {
  await db.insert(teamTable).values({ id: TEAM_ID, name: "Acme", slug: TEAM_ID, subscriptionPlanId: PAID_PLAN_ID });
  await claimTeamSubscription({ teamId: TEAM_ID, subscriptionId: SUBSCRIPTION_ID });
  await seedMember({ userId: "owner_a", roleId: SYSTEM_ROLES_ENUM.OWNER });
  await seedMember({ userId: "owner_b", roleId: SYSTEM_ROLES_ENUM.OWNER });
  await seedMember({ userId: "buyer", roleId: SYSTEM_ROLES_ENUM.MEMBER, preferredLocale: BUYER_LOCALE });
}

function checkoutMetadata({ immediateStart }: { immediateStart: boolean }): Record<string, string> {
  return buildCheckoutConsentMetadata({ immediateStart, userId: "buyer", at: CONSENT_AT, locale: BUYER_LOCALE, text: "Start now" });
}

// Stripe keeps an incomplete subscription up to 23 hours before the payment.
const DIALOG_OPEN_BEFORE_PAYMENT_MS = 20 * 60 * 60 * 1000;

async function deliver({
  status,
  metadata = {},
}: {
  status: Stripe.Subscription.Status;
  metadata?: Record<string, string>;
}): Promise<void> {
  const subscription = {
    id: SUBSCRIPTION_ID,
    object: "subscription",
    status,
    customer: "cus_order",
    cancel_at_period_end: false,
    // Stripe made the incomplete subscription when the dialog opened; the order is the payment.
    start_date: Math.floor((STARTED_AT.getTime() - DIALOG_OPEN_BEFORE_PAYMENT_MS) / 1000),
    trial_start: null,
    latest_invoice: {
      id: "in_order",
      billing_reason: "subscription_create",
      status_transitions: { paid_at: Math.floor(STARTED_AT.getTime() / 1000) },
    },
    metadata: { ...metadata, teamId: TEAM_ID },
    items: {
      object: "list",
      data: [{
        id: "si_order",
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        price: { id: PAID_PRICE_ID, recurring: { interval: "month" } },
      }],
    },
  } as unknown as Stripe.Subscription;
  const stripe: StripeSubscriptionFetcher = { subscriptions: { retrieve: async () => subscription } };
  const event = { type: "customer.subscription.updated", data: { object: subscription } } as unknown as Stripe.Event;

  await handleStripeEvent(event, { stripe });
}

function orderConfirmations(): OrderConfirmationPayload[] {
  return queueSendMock.mock.calls
    .map(([message]) => message as { type: string; payload: EmailSendJobPayload })
    .filter((message) => message.type === SCHEDULED_JOB_TYPES.EMAIL_SEND)
    .map((message) => message.payload)
    .filter((payload): payload is OrderConfirmationPayload => payload.template === EMAIL_TEMPLATE_TYPES.ORDER_CONFIRMATION);
}

describe("EU order confirmation emails", () => {
  beforeEach(async () => {
    await clearRows();
    queueSendMock.mockReset();
    await seedTeam();
  });

  test.skipIf(EU_WITHDRAWAL_ENABLED)("sends nothing while the EU withdrawal flow is disabled", async () => {
    await deliver({ status: "active", metadata: checkoutMetadata({ immediateStart: true }) });

    expect(orderConfirmations()).toEqual([]);
  });

  describe.skipIf(!EU_WITHDRAWAL_ENABLED)("with the flow enabled", () => {
    test("the first payment emails the buyer once, with the consent and the last day to withdraw", async () => {
      await deliver({ status: "incomplete", metadata: checkoutMetadata({ immediateStart: true }) });
      expect(orderConfirmations()).toEqual([]);

      await deliver({ status: "active", metadata: checkoutMetadata({ immediateStart: true }) });

      expect(orderConfirmations()).toEqual([{
        to: "buyer@example.com",
        template: EMAIL_TEMPLATE_TYPES.ORDER_CONFIRMATION,
        locale: BUYER_LOCALE,
        data: {
          username: "buyer",
          teamName: "Acme",
          teamSlug: TEAM_ID,
          planName: TEAM_PLANS[PAID_PLAN_ID].name,
          startedAt: STARTED_AT.toISOString(),
          windowEndsAt: selectWithdrawalWindowEnd(STARTED_AT).toISOString(),
          consent: { at: CONSENT_AT.toISOString(), text: "Start now" },
        },
      }]);
    });

    test("an unticked box confirms the order without a consent", async () => {
      await deliver({ status: "active", metadata: checkoutMetadata({ immediateStart: false }) });

      expect(orderConfirmations().map((email) => email.data.consent)).toEqual([null]);
    });

    // A subscription made in the Stripe dashboard names no buyer.
    test("without a buyer it emails every owner", async () => {
      await deliver({ status: "active" });

      expect(orderConfirmations().map((email) => email.to).toSorted()).toEqual(["owner_a@example.com", "owner_b@example.com"]);
    });

    test("a buyer who no longer exists falls back to the owners", async () => {
      await deliver({ status: "active", metadata: { [SUBSCRIPTION_WITHDRAWAL_METADATA.orderUserId]: "gone" } });

      expect(orderConfirmations()).toHaveLength(2);
    });

    // The contract starts with the trial, so the end of the trial is no new order.
    test("a replay and the end of a trial send nothing more", async () => {
      await deliver({ status: "trialing", metadata: checkoutMetadata({ immediateStart: true }) });
      await deliver({ status: "trialing", metadata: checkoutMetadata({ immediateStart: true }) });
      await deliver({ status: "active", metadata: checkoutMetadata({ immediateStart: true }) });

      expect(orderConfirmations()).toHaveLength(1);
    });

    test("a failed enqueue logs one line and leaves a correct snapshot", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      queueSendMock.mockRejectedValueOnce(new Error("Queue is unavailable"));

      await deliver({ status: "active", metadata: checkoutMetadata({ immediateStart: true }) });

      const team = await db.query.teamTable.findFirst({ where: { id: TEAM_ID } });
      expect(team?.subscriptionStatus).toBe("active");
      expect(log.mock.calls.filter(([text]) => String(text).startsWith("notifyOrderConfirmation"))).toHaveLength(1);
      log.mockRestore();
    });
  });
});
