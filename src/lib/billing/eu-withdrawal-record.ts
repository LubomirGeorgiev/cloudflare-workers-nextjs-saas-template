import "server-only";

import type Stripe from "stripe";

import { callStripe, STRIPE_OPERATIONS, stripeErrorName } from "@/lib/billing/stripe-call";

// The writes to the withdrawal record, which is Stripe metadata (`docs/eu-withdrawal.md`), and the
// log line of a failed step. The keys are in `src/constants/eu-withdrawal.ts`; the reader is
// `readWithdrawalMetadata` in `eu-withdrawal-selectors.ts`.

/** Merges `metadata` into the subscription's metadata. Stripe keeps the keys that it does not name. */
export async function updateWithdrawalMetadata({
  stripe,
  subscriptionId,
  metadata,
}: {
  stripe: WithdrawalRecordStripe;
  subscriptionId: string;
  metadata: Record<string, string>;
}): Promise<void> {
  // No idempotency key: the values differ on each call, and writing the same keys twice is harmless.
  await callStripe({
    operation: STRIPE_OPERATIONS.subscriptionsUpdate,
    run: () => stripe.subscriptions.update(subscriptionId, { metadata }),
  });
}

/** One `eu_withdrawal_step_failed` line. The resume job tries the step again. */
export function logStepFailure({ step, subscriptionId, error }: { step: string; subscriptionId: string; error: unknown }): void {
  console.error(JSON.stringify({ event: "eu_withdrawal_step_failed", step, subscriptionId, errorName: stripeErrorName(error) }));
}

// The subset of the Stripe client the record write drives. Narrowed so tests can pass a fake.
export interface WithdrawalRecordStripe {
  subscriptions: {
    update: (
      id: string,
      params: Stripe.SubscriptionUpdateParams,
      options?: Stripe.RequestOptions,
    ) => Promise<Stripe.Subscription>;
  };
}
