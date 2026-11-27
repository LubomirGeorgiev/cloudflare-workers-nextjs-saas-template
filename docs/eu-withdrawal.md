# EU right of withdrawal

How the template handles the consumer right of withdrawal (Directive 2011/83/EU, art. 9 to 16, and
the withdrawal function of art. 11a). `EU_WITHDRAWAL_ENABLED` in `src/constants.ts` is the master
switch. It is `false` in the template. When it is `false`, checkout and billing work as before.

## The parts

| Part | Module |
| --- | --- |
| Rules: window, eligibility, refund, metadata | `src/lib/billing/eu-withdrawal-selectors.ts` |
| Fork decisions: who is a consumer, extra charges | `src/lib/billing/eu-withdrawal-seams.ts` |
| Checkout consent to an immediate start | `src/lib/billing/checkout-consent.ts` |
| Order confirmation email (sent durably: a D1 job row first, so a queue outage cannot lose it) | `src/lib/billing/order-confirmation.ts` |
| Offer, withdrawal, resume job, and receipt | `src/lib/billing/eu-withdrawal.ts` |
| Cancel, void, and credit notes (steps 4 to 6 and 8) | `src/lib/billing/eu-withdrawal-refunds.ts` |
| Recovery scan and failed refunds | `src/lib/billing/eu-withdrawal-recovery.ts` |
| Metadata write and the step failure log | `src/lib/billing/eu-withdrawal-record.ts` |
| Daily recovery scan (paced cron task) | `src/lib/scheduler/worker.ts` |
| `refund.failed` webhook | `src/utils/stripe-webhook-handler.ts` |
| Shared Stripe reads: the subscription, the consumer check, the contract start | `src/lib/billing/eu-withdrawal-reads.ts` |

Each module types only the Stripe calls that it makes, so a test fake holds only those calls.
| Button and confirm dialog | `billing/_components/withdrawal-card.tsx` |
| Server action | `billing/withdrawal.actions.ts` |

The billing page and the action call the same eligibility selector, so the button shows only when
the action accepts the withdrawal. The dialog sends back the subscription ID that it showed. When
the team has another subscription now, the action refuses with `CONFLICT` and
`errorWithdrawalStale`, and the card reloads the page. An old dialog in a second tab thus cannot
withdraw from a contract that the owner made after it.

## The seams

A fork edits `src/lib/billing/eu-withdrawal-seams.ts` and no other file of the flow.

- `isConsumerCustomer({ customer, paymentMethod })`: whether the customer is a consumer in the
  EU or EEA. Only they have the right of withdrawal. The default needs both:
  - **No tax ID.** A customer with a tax ID is a business. The caller expands `customer.tax_ids`;
    without the expand, the function throws.
  - **A country in `EU_EEA_COUNTRY_CODES`** (`src/constants/eu-withdrawal.ts`): the 27 EU members,
    plus Iceland, Liechtenstein, and Norway, which the EEA Agreement binds to the same directive.
    The French outermost regions are EU territory with their own ISO codes, so the list also holds
    GF, GP, MF, MQ, RE, and YT. The Canary Islands, the Azores, and Madeira use ES and PT. Ask a
    lawyer to confirm the list for your fork.
    The first country found wins: the customer's `address.country`, then the payment method's
    `billing_details.address.country`, then the card's issuing `card.country`. The payment method
    is the subscription's `default_payment_method`, else the customer's
    `invoice_settings.default_payment_method`.
  - **No known country counts as the EU.** A missed EU consumer is a legal risk; an extra refund is
    only a cost.

  **These signals are weak.** The Stripe Customer Portal lets a customer remove a tax ID or change
  the address, so a business can make itself a consumer before it withdraws. A fork that sells to
  businesses must use a stronger signal, for example a business flag that only staff can set.

  One subscription read (`retrieveWithdrawalSubscription`) expands everything this check and the
  contract start need, so the check costs no extra Stripe call.
- `getWithdrawalExtraCharges({ subscription, withdrawnAt })`: what the consumer owes on top of the
  used days, in minor units. The flow calls it only when the consumer gave consent. The default is 0.
  Read only `withdrawnAt`, never the current time: the resume job calls the seam again and must get
  the same sum.

## The window

The contract starts when the consumer pays the subscription's first invoice
(`status_transitions.paid_at`, `selectContractStart`). It is never earlier than
`subscription.start_date`. Do not use `start_date` alone: Stripe sets it when the checkout dialog
opens and keeps the incomplete subscription up to 23 hours, so a window from `start_date` can end a
day early. A trial is the exception: its subscription is made after the card is confirmed, so its
`start_date` is the order.

The checkout consent box shows for every buyer, because the country is not known before the
payment. The order confirmation email states the consent and the last day to withdraw only when
`isConsumerCustomer` says EU consumer. A business or a customer outside the EU/EEA gets the plain
confirmation. The email reads the subscription once at the first activation. When that read fails,
the email uses the send time as the start and counts the customer as an EU consumer.

`readContractStart` reads this with the least work. The subscription read expands
`latest_invoice`, which in the window is almost always the first invoice, so it costs no call. Only
a later invoice in the window (a change from monthly to yearly) needs a list of the invoices. The
billing page, the withdrawal, the resume job, the order confirmation, and the receipt all use it.

A new subscription is a new contract and opens a new window. The order day does not count, so the
window ends at the close of the 14th day after it (art. 9).

The consumer can live in any EU time zone, from UTC-4 to UTC+4 (outermost regions included). The
rule reads the order day at UTC+4 and ends the window at the close of the day at UTC-4, plus one
hour for clock skew (`selectWithdrawalWindowEnd`). In some zones the window stays open some hours
too long. In no zone does it close early.

## The record

Stripe metadata is the record. There is no D1 table. The keys are in `src/constants/eu-withdrawal.ts`.
`readWithdrawalMetadata` reads them, and `updateWithdrawalMetadata` writes them.

| Object | Key | Holds |
| --- | --- | --- |
| Subscription | `eu_order_user_id` | The user who ordered |
| Subscription | `eu_consent_at`, `eu_consent_version`, `eu_consent_locale`, `eu_consent_text` | The consent to an immediate start, in the words the buyer saw |
| Subscription | `eu_withdrawn_at`, `eu_withdrawn_by_user_id` | The withdrawal |
| Subscription | `eu_receipt_sent_at` | The receipt is queued |
| Subscription | `eu_resume_at` | The run time of the one resume job that may continue |
| Subscription | `teamId` | The team. The claim writes it, and the recovery scan reads it |
| Subscription | `eu_withdrawal_needs_staff_at` | The flow stopped, and staff must finish the refund |
| Subscription | `eu_withdrawal_refund_failed_at` | A refund failed after its credit note. Staff pay that one; the chain goes on |
| Subscription | `eu_withdrawal_completed_at` | Every refund is issued and the receipt is sent. The recovery scan skips it |
| Credit note | `eu_withdrawal_subscription_id` | The subscription that the refund belongs to |

## The withdrawal

`withdrawFromContract` runs these steps:

1. Read the subscription with `customer.tax_ids`, and decide eligibility.
2. Read the subscription's invoices and compute the refund for the receipt. Nothing is written yet.
3. Save the resume job (durable, in D1 first). Then write `eu_withdrawn_at`,
   `eu_withdrawn_by_user_id`, `eu_resume_at` (the job's run time), and `teamId`. This write is the claim. A
   recorded withdrawal skips this step. When the claim fails, the flow reads the subscription
   again: a lost response or a fast double click can have recorded it already.
4. Cancel the subscription, unless it already ended.
5. Read the invoices again, after the cancel. Void each draft and each open invoice, and delete
   the subscription's pending invoice items (prorations that would join a later invoice). Stripe
   deletes only a one-off draft, so the flow finalizes a subscription draft with
   `auto_advance: false` and then voids it. A draft with a zero total is paid when it is finalized,
   so there is nothing to void. When Stripe refuses one void, the flow logs it, goes on, and marks
   the withdrawal for staff at the end.
6. Write the cancelled subscription to the team row.
7. When a withdrawal is recorded and `eu_receipt_sent_at` is missing, queue the receipt to the user
   who withdrew, then write `eu_receipt_sent_at`. The receipt states the refund that step 5 read,
   so it names the amount that step 8 refunds. When a step before it fails, the receipt still goes
   out, with the refund from step 2 (the action) or a new read (the resume job). A failure between
   the send and the write sends a second receipt later. That is acceptable; no receipt is not.
8. Refund each counted invoice with one credit note (`refund_amount`). With consent, the used
   days count from the contract start, never from an earlier line period start, so the consumer
   does not pay for the hours before the order. A proration credit line (an interval change in
   the window) counts with its negative amount, so the days after the change count once. Only
   our own earlier credit notes (with `eu_withdrawal_subscription_id`) lower the refund. A goodwill
   credit note from staff does not.
9. When every refund is issued and the receipt is sent, write `eu_withdrawal_completed_at`.

Stripe cannot credit more than what is left on the invoice. Every earlier post-payment credit note
and every direct refund of the charge lower that sum (`selectInvoiceCreditable`). When our refund is
larger, the credit note refunds what is left, and staff pay the rest by another path. A credit note
that Stripe refuses on one invoice does not stop the refunds of the other invoices.

Each Stripe write that must happen once has an idempotency key: `eu-withdrawal-record:`,
`eu-withdrawal-cancel:`, `eu-withdrawal-finalize:`, `eu-withdrawal-void:`, and `eu-withdrawal-refund:`,
followed by the Stripe ID.

When a step after step 3 fails, the action returns `completed: false`. The user sees that the
withdrawal is recorded and that the refund follows.

### The resume job

`billing.eu-withdrawal-resume` repeats steps 4 to 9 with the recorded `eu_withdrawn_at`. It runs
every hour until it ends:

- **One chain per withdrawal.** Each saved run time has its own job row, so a second save never
  replaces the job that `eu_resume_at` names. A job continues only when its run time equals `eu_resume_at`. A
  job from a failed request, or one that a later job replaced, stops at once. To reschedule, the
  job saves the next job first and then writes the next `eu_resume_at`. When that write fails, the
  queue retries the same message, which still owns the chain.
- **Done.** Every refund is issued, and `eu_receipt_sent_at` is set. A missing receipt keeps the
  chain going, but it does not hold back the refunds. `selectChainEnd` holds this rule and the
  staff rule below. The job, the action, and the recovery scan all call it, for a run's result
  and for the stored record. A job that finds `eu_withdrawal_completed_at` stops at once.
- **Staff.** An invoice with no charge, a refund above what Stripe can still credit, or a Stripe
  refusal that fails the same way on every try (a refunded charge, a dispute, a missing object)
  writes `eu_withdrawal_needs_staff_at` and logs one `eu_withdrawal_refund_needs_staff` line with
  the invoice IDs. The chain then ends, but only when the receipt is sent. Without the receipt, the
  next jobs send only the receipt; staff own the refund.
- **Maximum age.** 30 days after the withdrawal, the job logs `eu_withdrawal_resume_gave_up` (with
  `receiptSent`) and ends the chain. From day 14 on, each run with a refund still due logs
  `eu_withdrawal_refund_overdue` (art. 13).

### The recovery scan

The queue drops a job after its last retry (`max_retries` in `wrangler.jsonc`, about 7.5 minutes),
and the durable row is gone after the send. A Stripe outage longer than that would end the chain
with no alert. A paced cron task in `src/lib/scheduler/worker.ts` runs `recoverStalledWithdrawals`
once a day. It runs only when `EU_WITHDRAWAL_ENABLED` is `true` and billing is set up.

The scan searches Stripe for subscriptions with `eu_withdrawn_at` that were made in the last 47
days (the window plus the maximum age). `selectStalledWithdrawal` keeps a withdrawal that is not
complete, still has work for the chain, is younger than the maximum age, and whose `eu_resume_at`
is at least `RESUME_STALL_AFTER_MS` in the past. A live chain always names a later run time. The
scan enqueues the job with that run time, so the resume guard accepts it. Each recovery logs
`eu_withdrawal_resume_recovered`. The scan reads the team from `teamId`. When a record has no
`teamId`, the scan finds the team with `reconcileTeamFromSubscription`, which also matches a team by
its Stripe customer. Stripe Search is not available to businesses in India, and its
results can be up to a minute old.

When the scan enqueues a job that the queue still holds, both jobs run once. Each saves a next job,
and the last write of `eu_resume_at` wins, so the other chain stops as superseded.

### A refund that fails later

A card refund can fail days after its credit note, for example on a closed card. The webhook
routes `refund.failed` to `flagFailedWithdrawalRefund`. It finds the invoice of the refund's payment
intent, and our credit note that holds the refund. It logs `eu_withdrawal_refund_failed` first, so
the alert fires also when the next write fails. It then writes `eu_withdrawal_refund_failed_at`.
It does not write `eu_withdrawal_needs_staff_at`: that mark ends the refunds, and another invoice
can still wait for a retry. Our credit note still counts as refunded, so the flow does not refund
twice. Staff pay the consumer by another path.

### Why the cancel parameters differ

Every other cancel of a subscription that ran uses `cancelParamsForStatus`, which passes
`invoice_now: true`. The withdrawal passes `WITHDRAWAL_CANCEL_PARAMS` (`invoice_now: false`,
`prorate: false`). The refund comes from the paid invoices. A final invoice would bill the consumer
after that sum, and a proration credit would pay them twice.

### An invoice with no charge

A refund goes back to a card or bank charge. An invoice paid from the customer balance or out of
band has no charge. The flow does not refund it and does not credit the balance. It marks the
withdrawal for staff. Staff refund that invoice by hand with a credit note.

## Legal text

The button label `withdrawButton` and the confirm label `confirmWithdrawal` are legal text. Keep
them as the catalogs state them, in every locale. The confirm step shows the name, the email, and
the contract. It has no field for reasons and no offers. Do not add a step between the two buttons.

## Launch checklist

Before you set `EU_WITHDRAWAL_ENABLED` to `true`:

- Replace the default `isConsumerCustomer` with a business signal that the customer cannot change.
- Add `refund.failed` to the events of your Stripe webhook endpoint. `pnpm stripe:setup --with-webhook`
  adds it to a new endpoint; add it by hand to an existing endpoint.
- Add an alert on each of these log events:

| Event | Means |
| --- | --- |
| `eu_withdrawal_refund_needs_staff` | The flow stopped. Staff must finish the refund by hand |
| `eu_withdrawal_resume_gave_up` | The refund is still not done 30 days after the withdrawal |
| `eu_withdrawal_refund_overdue` | A recorded withdrawal is not refunded 14 days after it reached us (art. 13) |
| `eu_withdrawal_receipt_no_recipient` | The user who withdrew has no email address; send the receipt by hand |
| `eu_withdrawal_step_failed` | A step failed; the resume job tries again |
| `eu_withdrawal_refund_failed` | Stripe could not pay a withdrawal refund back. Staff must refund by another path |
| `eu_withdrawal_resume_recovered` | The queue dropped a resume chain, and the daily scan started it again |
| `eu_withdrawal_resume_recovery_failed` | The scan could not start a dropped chain again (no team, the team lookup failed, or the save failed) |
| `eu_withdrawal_recovery_truncated` | The scan read its page limit; some withdrawals waited for the next day |
| `eu_withdrawal_offer_failed` | The billing page hid the button because Stripe failed |
| `eu_order_confirmation_read_failed` | The order confirmation used the send time as the start and counted the customer as an EU consumer |
