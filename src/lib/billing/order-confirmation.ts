import "server-only";

import type Stripe from "stripe";

import { EU_WITHDRAWAL_ENABLED } from "@/constants";
import { getPlan } from "@/constants/plans";
import { getDB } from "@/db";
import type { Team } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import {
  isWithdrawalConsumer,
  readContractStart,
  retrieveWithdrawalSubscription,
} from "@/lib/billing/eu-withdrawal-reads";
import { stripeErrorName } from "@/lib/billing/stripe-call";
import {
  isFirstActivation,
  readWithdrawalMetadata,
  selectWithdrawalWindowEnd,
} from "@/lib/billing/eu-withdrawal-selectors";
import { getStripe } from "@/lib/stripe";
import { listTeamOwnerRecipients } from "@/lib/teams/team-owners";
import { saveOrderConfirmationEmail, sendSavedEmail, type SavedEmail } from "@/utils/email";
import { hashToken } from "@/utils/random-token";
import { classifySubscriptionItems } from "@/utils/subscription-items";

// One job row per subscription and recipient. The hash keeps the address out of D1 and KV keys.
const ORDER_CONFIRMATION_KEY_PREFIX = "order-confirmation:";

/**
 * Saves the EU order confirmation as job rows before the snapshot write claims the first activation.
 * A failure here throws before the claim, so the stored status stays and a webhook retry saves again.
 * `team` is the row that the caller read before the write.
 */
export async function saveOrderConfirmation({
  team,
  subscription,
}: {
  team: Pick<Team, "id" | "name" | "slug" | "subscriptionPlanId" | "subscriptionStatus" | "stripeSubscriptionId">;
  subscription: Stripe.Subscription;
}): Promise<SavedEmail[]> {
  if (!EU_WITHDRAWAL_ENABLED || !isOrderConfirmationDue({ previous: team, subscription })) {
    return [];
  }

  const record = readWithdrawalMetadata(subscription.metadata);
  const { startedAt, euConsumer } = await readWithdrawalTerms(subscription);
  const recipients = await listRecipients({ teamId: team.id, orderUserId: record.orderUserId });
  const planName = getPlan(classifySubscriptionItems(subscription).planId ?? team.subscriptionPlanId).name;

  // Team owners are few (a seat cap), so one save per recipient is a short list.
  return Promise.all(recipients.map(async (recipient) => saveOrderConfirmationEmail({
    dedupeKey: `${ORDER_CONFIRMATION_KEY_PREFIX}${subscription.id}:${await hashToken(recipient.email.trim().toLowerCase())}`,
    email: recipient.email,
    username: recipient.username,
    teamName: team.name,
    teamSlug: team.slug,
    planName,
    startedAt,
    withdrawal: euConsumer
      ? {
        windowEndsAt: selectWithdrawalWindowEnd(startedAt),
        consent: record.consent ? { at: record.consent.at, text: record.consent.text } : null,
      }
      : null,
    locale: recipient.locale ?? undefined,
  })));
}

/**
 * Sends the saved rows when the snapshot write claimed the first activation. Otherwise a concurrent
 * write claimed it: that write saved the same keys and sends them, so this one leaves its rows to it
 * and to the cron. Never throws: a failed send leaves the row for the cron.
 */
export async function sendOrderConfirmation({
  saved,
  subscription,
  previous,
}: {
  saved: SavedEmail[];
  subscription: Stripe.Subscription;
  previous: OrderConfirmationState;
}): Promise<void> {
  if (!saved.length || !isOrderConfirmationDue({ previous, subscription })) {
    return;
  }

  await Promise.all(saved.map((email) => sendSavedEmail(email)));
}

/** True when this write starts the subscription's access for the first time on this team. */
export function isOrderConfirmationDue({
  previous,
  subscription,
}: {
  previous: OrderConfirmationState;
  subscription: Pick<Stripe.Subscription, "id" | "status">;
}): boolean {
  const replacedSubscription = previous.stripeSubscriptionId !== null && previous.stripeSubscriptionId !== subscription.id;

  return !replacedSubscription && isFirstActivation({ previousStatus: previous.subscriptionStatus, status: subscription.status });
}

// One read at the first activation: the webhook's subscription has no customer data. On a failure,
// "now" (after the payment) ends the window late, never early, and the customer counts as an EU
// consumer, like a customer with no known country (`isConsumerCustomer`).
async function readWithdrawalTerms(subscription: Stripe.Subscription): Promise<{ startedAt: Date; euConsumer: boolean }> {
  try {
    const stripe = await getStripe();
    const full = await retrieveWithdrawalSubscription({ stripe, subscriptionId: subscription.id });

    return { startedAt: await readContractStart({ stripe, subscription: full }), euConsumer: isWithdrawalConsumer(full) };
  } catch (error) {
    console.error(JSON.stringify({
      event: "eu_order_confirmation_read_failed",
      provider: "stripe",
      subscriptionId: subscription.id,
      errorName: stripeErrorName(error),
    }));
    return { startedAt: new Date(), euConsumer: true };
  }
}

// The user who checked out gets the confirmation. A subscription made in the Stripe dashboard
// names no such user, so every owner gets it.
async function listRecipients({
  teamId,
  orderUserId,
}: {
  teamId: string;
  orderUserId: string | null;
}): Promise<Recipient[]> {
  const orderUser = orderUserId
    ? await getDB().query.userTable.findFirst({
      where: { id: orderUserId },
      columns: { email: true, firstName: true, preferredLocale: true },
    })
    : undefined;
  if (orderUser?.email) {
    return [{
      email: orderUser.email,
      username: orderUser.firstName?.trim() || orderUser.email,
      locale: orderUser.preferredLocale ?? null,
    }];
  }

  return listTeamOwnerRecipients({ teamId });
}

interface Recipient {
  email: string;
  username: string;
  locale: Locale | null;
}

interface OrderConfirmationState {
  subscriptionStatus: string | null;
  stripeSubscriptionId: string | null;
}
