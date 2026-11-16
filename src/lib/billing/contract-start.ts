import "server-only";

import type Stripe from "stripe";

import { selectContractStart } from "@/lib/billing/eu-withdrawal-selectors";
import { callStripe, STRIPE_OPERATIONS } from "@/lib/billing/stripe-call";

// The one read of when an EU contract started (`selectContractStart`). The withdrawal flow and the
// order confirmation both call it; a separate module keeps the order confirmation free of the flow.

// The first invoice of a subscription is among its first few. A withdrawal happens within weeks.
const FIRST_INVOICE_LIST_LIMIT = 100;
const FIRST_INVOICE_REASON = "subscription_create";

/**
 * The contract start of `subscription`. In the window, `latest_invoice` is almost always the first
 * invoice, so an expanded one costs no call. Only a later invoice in the window (an interval
 * change) needs a list. A trial needs no read: its subscription is made after the order.
 */
export async function readContractStart({
  stripe,
  subscription,
}: {
  stripe: ContractStartStripe;
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

async function findFirstInvoice({
  stripe,
  subscription,
}: {
  stripe: ContractStartStripe;
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
interface ContractStartStripe {
  invoices: {
    retrieve: (id: string) => Promise<Stripe.Invoice>;
    list: (params: Stripe.InvoiceListParams) => Promise<{ data: Stripe.Invoice[] }>;
  };
}
