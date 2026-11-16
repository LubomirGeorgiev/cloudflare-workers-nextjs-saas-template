import "server-only";

import type Stripe from "stripe";

import { WITHDRAWAL_PERIOD_DAYS } from "@/constants/eu-withdrawal";
import { getDB } from "@/db";
import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/translator";
import { ActionError } from "@/lib/action-error";
import { buildCheckoutConsentMetadata } from "@/lib/billing/eu-withdrawal-selectors";
import { callStripe, STRIPE_OPERATIONS } from "@/lib/billing/stripe-call";
import { getStripe } from "@/lib/stripe";
import { getStripeId } from "@/utils/stripe-id";

// The intent statuses the client can still confirm. From `processing` on (a SEPA debit stays
// there for days) the payment has started, so the consent it was given is final.
const CONFIRMABLE_INTENT_STATUSES: ReadonlySet<string> = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
]);

/**
 * Stores the EU immediate-start consent on the checkout the client is about to confirm: the
 * incomplete subscription of a paid plan, or the SetupIntent of a trial. The server renders the
 * text from the catalog, so the record holds the exact words the buyer saw, not client input.
 */
export async function recordCheckoutConsent({
  teamId,
  userId,
  immediateStart,
  setupIntentId,
  locale,
  now = new Date(),
}: {
  teamId: string;
  userId: string;
  immediateStart: boolean;
  setupIntentId?: string;
  locale: Locale;
  now?: Date;
}): Promise<void> {
  const [team, t] = await Promise.all([
    getDB().query.teamTable.findFirst({ where: { id: teamId } }),
    getTranslator({ locale, namespace: "Client.Dashboard.Billing" }),
  ]);
  if (!team?.stripeCustomerId) {
    throw refusal();
  }

  const metadata = buildCheckoutConsentMetadata({
    immediateStart,
    userId,
    at: now,
    locale,
    text: t("immediateStartConsent", { days: WITHDRAWAL_PERIOD_DAYS }),
  });
  const stripe = await getStripe();

  if (setupIntentId) {
    const setupIntent = await callStripe({
      operation: STRIPE_OPERATIONS.setupIntentsRetrieve,
      run: () => stripe.setupIntents.retrieve(setupIntentId),
    });
    if (getStripeId(setupIntent.customer) !== team.stripeCustomerId
      || setupIntent.metadata?.teamId !== teamId
      || !CONFIRMABLE_INTENT_STATUSES.has(setupIntent.status)) {
      throw refusal();
    }
    await callStripe({
      operation: STRIPE_OPERATIONS.setupIntentsUpdate,
      run: () => stripe.setupIntents.update(setupIntentId, { metadata }),
    });
    return;
  }

  const subscriptionId = team.stripeSubscriptionId;
  if (!subscriptionId) {
    throw refusal();
  }
  const subscription = await callStripe({
    operation: STRIPE_OPERATIONS.subscriptionsRetrieve,
    run: () => stripe.subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice.payments"] }),
  });
  // Only an unpaid first checkout takes a consent. A running contract keeps the one it has.
  if (subscription.status !== "incomplete"
    || getStripeId(subscription.customer) !== team.stripeCustomerId
    || subscription.metadata?.teamId !== teamId) {
    throw refusal();
  }
  const paymentIntentId = firstInvoicePaymentIntentId(subscription);
  if (!paymentIntentId) {
    throw refusal();
  }
  const paymentIntent = await callStripe({
    operation: STRIPE_OPERATIONS.paymentIntentsRetrieve,
    run: () => stripe.paymentIntents.retrieve(paymentIntentId),
  });
  if (!CONFIRMABLE_INTENT_STATUSES.has(paymentIntent.status)) {
    throw refusal();
  }
  await callStripe({
    operation: STRIPE_OPERATIONS.subscriptionsUpdate,
    run: () => stripe.subscriptions.update(subscriptionId, { metadata }),
  });
}

// On the dahlia API an invoice names its PaymentIntent through its payments, not a field of its own.
function firstInvoicePaymentIntentId(subscription: Stripe.Subscription): string | null {
  const invoice = subscription.latest_invoice;
  if (!invoice || typeof invoice === "string") {
    return null;
  }
  const payment = invoice.payments?.data.find((entry) => entry.is_default) ?? invoice.payments?.data[0];

  return getStripeId(payment?.payment.payment_intent);
}

function refusal(): ActionError {
  return new ActionError("PRECONDITION_FAILED", { key: "Client.Dashboard.Billing.errorStartCheckout" });
}
