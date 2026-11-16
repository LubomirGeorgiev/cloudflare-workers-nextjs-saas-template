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
import { sendOrderConfirmationEmail } from "@/utils/email";
import { classifySubscriptionItems } from "@/utils/subscription-items";

/**
 * Sends the EU order confirmation when a subscription first gives access. The caller's snapshot
 * write is the claim: its batch read the status just before it, so a replay sends nothing.
 * Never throws: the snapshot write already landed, and an email must not fail the reconcile.
 */
export async function notifyOrderConfirmation({
  team,
  subscription,
  previous,
}: {
  team: Pick<Team, "id" | "name" | "slug" | "subscriptionPlanId">;
  subscription: Stripe.Subscription;
  previous: { subscriptionStatus: string | null; stripeSubscriptionId: string | null };
}): Promise<void> {
  const replacedSubscription = previous.stripeSubscriptionId !== null && previous.stripeSubscriptionId !== subscription.id;
  if (!EU_WITHDRAWAL_ENABLED
    || replacedSubscription
    || !isFirstActivation({ previousStatus: previous.subscriptionStatus, status: subscription.status })) {
    return;
  }

  const record = readWithdrawalMetadata(subscription.metadata);
  const { startedAt, euConsumer } = await readWithdrawalTerms(subscription);
  const recipients = await listRecipients({ teamId: team.id, orderUserId: record.orderUserId }).catch((error: unknown) => {
    console.error("notifyOrderConfirmation: recipient read failed", { teamId: team.id, subscriptionId: subscription.id, error });
    return [];
  });

  await Promise.all(recipients.map((recipient) => sendOrderConfirmationEmail({
    email: recipient.email,
    username: recipient.username,
    teamName: team.name,
    teamSlug: team.slug,
    planName: getPlan(classifySubscriptionItems(subscription).planId ?? team.subscriptionPlanId).name,
    startedAt,
    withdrawal: euConsumer
      ? {
        windowEndsAt: selectWithdrawalWindowEnd(startedAt),
        consent: record.consent ? { at: record.consent.at, text: record.consent.text } : null,
      }
      : null,
    locale: recipient.locale ?? undefined,
  }).catch((error: unknown) => {
    console.error("notifyOrderConfirmation: email enqueue failed", { teamId: team.id, subscriptionId: subscription.id, error });
  })));
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
