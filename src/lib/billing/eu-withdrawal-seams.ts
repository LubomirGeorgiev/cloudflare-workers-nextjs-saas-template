import "server-only";

import type Stripe from "stripe";

// The EU withdrawal decisions a fork makes for its own business. Edit this file; the rest of the
// flow calls these two functions and keeps their contracts.

/**
 * Whether the customer is a consumer, who has the right of withdrawal. The default treats a
 * customer with a tax ID as a business. The caller must expand `customer.tax_ids`.
 */
export function isConsumerCustomer(customer: Stripe.Customer | Stripe.DeletedCustomer): boolean {
  if (customer.deleted) {
    return false;
  }
  // Without the expand we cannot tell, and a guess either way breaks the law or gives refunds away.
  if (!customer.tax_ids) {
    throw new Error("isConsumerCustomer needs the customer with `tax_ids` expanded");
  }

  return customer.tax_ids.data.length === 0;
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
