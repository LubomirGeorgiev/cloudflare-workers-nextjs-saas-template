import "server-only";

import type Stripe from "stripe";

import { isConsumerCustomer } from "@/lib/billing/eu-withdrawal-seams";
import { selectContractStart } from "@/lib/billing/eu-withdrawal-selectors";
import { callStripe, STRIPE_OPERATIONS } from "@/lib/billing/stripe-call";

// The Stripe reads that the withdrawal flow and the order confirmation share: the subscription,
// whether its customer is an EU consumer, and when the contract started. A separate module keeps
// the order confirmation free of the flow.

// One read gives the consumer check (`isConsumerCustomer`) and the contract start what they need.
const WITHDRAWAL_SUBSCRIPTION_EXPAND = [
  "customer.tax_ids",
  "customer.invoice_settings.default_payment_method",
  "default_payment_method",
  "latest_invoice",
];

// The first invoice of a subscription is among its first few. A withdrawal happens within weeks.
const FIRST_INVOICE_LIST_LIMIT = 100;
const FIRST_INVOICE_REASON = "subscription_create";

/** The subscription with everything `isWithdrawalConsumer` and `readContractStart` read. */
export function retrieveWithdrawalSubscription({
  stripe,
  subscriptionId,
}: {
  stripe: WithdrawalReadStripe;
  subscriptionId: string;
}): Promise<Stripe.Subscription> {
  return callStripe({
    operation: STRIPE_OPERATIONS.subscriptionsRetrieve,
    run: () => stripe.subscriptions.retrieve(subscriptionId, { expand: WITHDRAWAL_SUBSCRIPTION_EXPAND }),
  });
}

/** The fork's consumer check (`isConsumerCustomer`) on a subscription from `retrieveWithdrawalSubscription`. */
export function isWithdrawalConsumer(subscription: Stripe.Subscription): boolean {
  const { customer } = subscription;
  if (typeof customer === "string") {
    throw new TypeError("The withdrawal needs the subscription with its customer expanded");
  }
  const customerDefault = customer.deleted ? null : customer.invoice_settings?.default_payment_method;

  return isConsumerCustomer({
    customer,
    paymentMethod: expandedPaymentMethod(subscription.default_payment_method) ?? expandedPaymentMethod(customerDefault),
  });
}

/**
 * The contract start of `subscription`. In the window, `latest_invoice` is almost always the first
 * invoice, so an expanded one costs no call. Only a later invoice in the window (an interval
 * change) needs a list. A trial needs no read: its subscription is made after the order.
 */
export async function readContractStart({
  stripe,
  subscription,
}: {
  stripe: WithdrawalReadStripe;
  subscription: Stripe.Subscription;
}): Promise<Date> {
  const startDate = new Date(subscription.start_date * 1000);
  if (subscription.trial_start) {
    return selectContractStart({ startDate, firstInvoicePaidAt: null });
  }
  const latestInvoice = subscription.latest_invoice;
  const latest = typeof latestInvoice === "string"
    ? await callStripe({
      operation: STRIPE_OPERATIONS.invoicesRetrieve,
      run: () => stripe.invoices.retrieve(latestInvoice),
    })
    : latestInvoice;
  const first = latest?.billing_reason === FIRST_INVOICE_REASON ? latest : await findFirstInvoice({ stripe, subscription });
  const paidAt = first?.status_transitions?.paid_at;

  return selectContractStart({ startDate, firstInvoicePaidAt: paidAt ? new Date(paidAt * 1000) : null });
}

function expandedPaymentMethod(value: string | Stripe.PaymentMethod | null | undefined): Stripe.PaymentMethod | null {
  return value && typeof value !== "string" ? value : null;
}

async function findFirstInvoice({
  stripe,
  subscription,
}: {
  stripe: WithdrawalReadStripe;
  subscription: Stripe.Subscription;
}): Promise<Stripe.Invoice | null> {
  const { data } = await callStripe({
    operation: STRIPE_OPERATIONS.invoicesList,
    run: () => stripe.invoices.list({
      subscription: subscription.id,
      created: { gte: subscription.start_date },
      limit: FIRST_INVOICE_LIST_LIMIT,
    }),
  });

  return data.find((invoice) => invoice.billing_reason === FIRST_INVOICE_REASON) ?? null;
}

// The subset of the Stripe client this read drives. Narrowed so tests can pass a fake.
export interface WithdrawalReadStripe {
  subscriptions: {
    retrieve: (id: string, params?: Stripe.SubscriptionRetrieveParams) => Promise<Stripe.Subscription>;
  };
  invoices: {
    retrieve: (id: string) => Promise<Stripe.Invoice>;
    list: (params: Stripe.InvoiceListParams) => Promise<{ data: Stripe.Invoice[] }>;
  };
}
