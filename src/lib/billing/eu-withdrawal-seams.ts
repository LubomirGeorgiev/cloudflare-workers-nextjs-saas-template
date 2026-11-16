import "server-only";

import type Stripe from "stripe";

import { EU_EEA_COUNTRY_CODES } from "@/constants/eu-withdrawal";

// The EU withdrawal decisions a fork makes for its own business. Edit this file; the rest of the
// flow calls these two functions and keeps their contracts.

const EU_EEA_COUNTRIES: ReadonlySet<string> = new Set(EU_EEA_COUNTRY_CODES);

/**
 * Whether the customer is a consumer in the EU or EEA, who has the right of withdrawal. The default:
 * no tax ID, and a country in `EU_EEA_COUNTRY_CODES`. The caller must expand `customer.tax_ids`.
 */
export function isConsumerCustomer({
  customer,
  paymentMethod,
}: {
  customer: Stripe.Customer | Stripe.DeletedCustomer;
  // The subscription's default payment method, else the customer's; null when neither is known.
  paymentMethod: Stripe.PaymentMethod | null;
}): boolean {
  if (customer.deleted) {
    return false;
  }
  // Without the expand we cannot tell, and a guess either way breaks the law or gives refunds away.
  if (!customer.tax_ids) {
    throw new Error("isConsumerCustomer needs the customer with `tax_ids` expanded");
  }
  if (customer.tax_ids.data.length > 0) {
    return false;
  }
  const country = customerCountry({ customer, paymentMethod });

  // No known country counts as the EU: a missed EU consumer is a legal risk, an extra refund only a cost.
  return !country || EU_EEA_COUNTRIES.has(country.toUpperCase());
}

/**
 * What a consumer who asked for an immediate start owes on top of the used days, in minor units.
 * Read only `withdrawnAt`, never the clock: a resumed withdrawal must get the same sum.
 */
export async function getWithdrawalExtraCharges(__params: {
  subscription: Stripe.Subscription;
  withdrawnAt: Date;
}): Promise<number> {
  return 0;
}

// The first country found: the customer's address, the billing address, then the card's issuer.
function customerCountry({
  customer,
  paymentMethod,
}: {
  customer: Stripe.Customer;
  paymentMethod: Stripe.PaymentMethod | null;
}): string | null {
  return customer.address?.country
    || paymentMethod?.billing_details?.address?.country
    || paymentMethod?.card?.country
    || null;
}
