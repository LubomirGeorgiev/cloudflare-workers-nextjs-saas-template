"use server";

import type Stripe from "stripe";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { getDB } from "@/db";
import { TEAM_PERMISSIONS } from "@/db/schema";
import { requireTeamPermission } from "@/utils/team-auth";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { getTeamBillingSummary } from "@/lib/billing/team-billing";
import { getStripe } from "@/lib/stripe";
import { isBillingEnabled } from "@/flags";
import { getPlan } from "@/constants/plans";
import { getAddonPriceId, getPlanPriceId } from "@/utils/plan-prices";
import { classifySubscriptionItems, resolvePlanItem } from "@/utils/subscription-items";
import { getAddon, getAddonMaxQuantity } from "@/constants/addons";
import {
  ensureStripeCustomer,
  claimTeamSubscription,
  reconcileTeamFromSubscription,
  isTrialEligible,
  settleRecordedSubscription,
} from "@/utils/team-subscription";
import { completeTrialSubscription } from "@/lib/teams/trial-subscription";
import {
  createSubscriptionSchema,
  changePlanSchema,
  completeTrialSchema,
  cancelSubscriptionSchema,
  teamBillingSchema,
  updateAddonQuantitySchema,
} from "@/schemas/billing.schema";
import { getLocale } from "next-intl/server";
import { getStripeSubscriptionTransitionPolicy } from "@/constants/subscription-lifecycle";
import { SITE_URL } from "@/constants";

// Reads the invoice's confirmation_secret client secret from an expanded subscription.
function readClientSecret(subscription: Stripe.Subscription): string | null {
  const invoice = subscription.latest_invoice;
  if (!invoice || typeof invoice === "string") {
    return null;
  }
  return invoice.confirmation_secret?.client_secret ?? null;
}

async function assertBillingEnabled() {
  if (!isBillingEnabled()) {
    throw new ActionError("PRECONDITION_FAILED", { key: "Client.Dashboard.Billing.billingDisabledNotice" });
  }
}

// Shared preamble for actions that operate on an EXISTING subscription (change/cancel/
// resume): asserts billing is enabled, requires the ACCESS_BILLING permission, and loads
// the team's active subscription id (throwing if there is none).
async function requireExistingSubscription(teamId: string) {
  await assertBillingEnabled();
  await requireTeamPermission(teamId, TEAM_PERMISSIONS.ACCESS_BILLING);

  const stripe = getStripe();
  const team = await getDB().query.teamTable.findFirst({ where: { id: teamId } });

  if (!team?.stripeSubscriptionId) {
    throw new ActionError("PRECONDITION_FAILED", { key: "Client.Dashboard.Billing.errorStartCheckout" });
  }

  return { stripe, subscriptionId: team.stripeSubscriptionId };
}

// The loser of a concurrent subscribe race discards its just-created incomplete
// subscription and returns the winner's checkout state, so double-clicking clients
// converge on a single payment flow.
async function convergeOnWinningCheckout({
  teamId,
  losingSubscriptionId,
}: {
  teamId: string;
  losingSubscriptionId: string;
}) {
  const stripe = getStripe();

  await stripe.subscriptions.cancel(losingSubscriptionId).catch((error: unknown) => {
    // Unpaid incomplete subscriptions auto-expire on Stripe's side, so a failed
    // cleanup is safe to leave behind.
    console.error("createSubscriptionAction: losing-subscription cleanup failed", error);
  });

  const winner = await getDB().query.teamTable.findFirst({ where: { id: teamId } });
  const winnerSubscription = winner?.stripeSubscriptionId
    ? await stripe.subscriptions.retrieve(winner.stripeSubscriptionId, {
      expand: ["latest_invoice.confirmation_secret"],
    }).catch(() => null)
    : null;
  const clientSecret = winnerSubscription ? readClientSecret(winnerSubscription) : null;

  if (!winnerSubscription || !clientSecret) {
    throw new ActionError("CONFLICT", { key: "Client.Dashboard.Billing.errorStartCheckout" });
  }

  return { success: true, clientSecret, subscriptionId: winnerSubscription.id };
}

export const createSubscriptionAction = actionClient
  .inputSchema(createSubscriptionSchema)
  .action(async ({ parsedInput: { teamId, planId, interval } }) => {
    return withRateLimit(async () => {
      await assertBillingEnabled();

      const session = await requireTeamPermission(teamId, TEAM_PERMISSIONS.ACCESS_BILLING);
      const stripe = getStripe();
      const db = getDB();

      const team = await db.query.teamTable.findFirst({ where: { id: teamId } });

      try {
        if (team?.stripeSubscriptionId) {
          await settleRecordedSubscription({ teamId, recordedSubscriptionId: team.stripeSubscriptionId });
        }

        const customerId = await ensureStripeCustomer({
          teamId,
          actingUserEmail: session.user.email,
        });

        const subscription = await stripe.subscriptions.create({
          customer: customerId,
          items: [{ price: getPlanPriceId({ planId, interval }) }],
          payment_behavior: "default_incomplete",
          payment_settings: { save_default_payment_method: "on_subscription" },
          expand: ["latest_invoice.confirmation_secret"],
          metadata: { teamId },
        }, {
          // Fresh per request: only pins this call's network retries. Nothing is
          // persisted, so a failed attempt cannot poison later ones.
          idempotencyKey: `team-subscription:${teamId}:${crypto.randomUUID()}`,
        });

        const claimedSlot = await claimTeamSubscription({
          teamId,
          subscriptionId: subscription.id,
        });

        if (!claimedSlot) {
          return await convergeOnWinningCheckout({ teamId, losingSubscriptionId: subscription.id });
        }

        // The slot is claimed; persist the full snapshot before responding.
        await reconcileTeamFromSubscription({ subscription });

        const clientSecret = readClientSecret(subscription);

        if (!clientSecret) {
          throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Dashboard.Billing.errorNoClientSecret" });
        }

        return {
          success: true,
          clientSecret,
          subscriptionId: subscription.id,
        };
      } catch (error) {
        if (error instanceof ActionError) {
          throw error;
        }
        console.error("createSubscriptionAction failed", error);
        throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Dashboard.Billing.errorPaymentProvider" });
      }
    }, RATE_LIMITS.BILLING);
  });

// Resolves the trial the acting user may start on this plan: 0 when the plan offers
// no trial or the team/user has already used theirs.
async function resolveTrialDays({
  teamId,
  planId,
  userId,
}: {
  teamId: string;
  planId: string;
  userId: string;
}): Promise<number> {
  const trialDays = getPlan(planId).trialDays ?? 0;
  if (trialDays <= 0) {
    return 0;
  }
  return (await isTrialEligible({ teamId, userId })) ? trialDays : 0;
}

// Card-first trial flow, step 1: hand the client a SetupIntent so the Payment Element
// can verify a payment method. No subscription exists at this point — abandoning the
// dialog grants no trial and no access.
export const startTrialSetupAction = actionClient
  .inputSchema(createSubscriptionSchema)
  .action(async ({ parsedInput: { teamId, planId, interval } }) => {
    return withRateLimit(async () => {
      await assertBillingEnabled();

      const session = await requireTeamPermission(teamId, TEAM_PERMISSIONS.ACCESS_BILLING);
      const stripe = getStripe();

      const trialDays = await resolveTrialDays({ teamId, planId, userId: session.user.id });
      if (trialDays <= 0) {
        throw new ActionError("PRECONDITION_FAILED", { key: "Client.Dashboard.Billing.errorTrialUnavailable" });
      }

      const team = await getDB().query.teamTable.findFirst({ where: { id: teamId } });

      try {
        if (team?.stripeSubscriptionId) {
          await settleRecordedSubscription({ teamId, recordedSubscriptionId: team.stripeSubscriptionId });
        }

        const customerId = await ensureStripeCustomer({
          teamId,
          actingUserEmail: session.user.email,
        });

        const setupIntent = await stripe.setupIntents.create({
          customer: customerId,
          usage: "off_session",
          metadata: { teamId, planId, interval },
        });

        if (!setupIntent.client_secret) {
          throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Dashboard.Billing.errorNoClientSecret" });
        }

        return { success: true, clientSecret: setupIntent.client_secret };
      } catch (error) {
        if (error instanceof ActionError) {
          throw error;
        }
        console.error("startTrialSetupAction failed", error);
        throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Dashboard.Billing.errorPaymentProvider" });
      }
    }, RATE_LIMITS.BILLING);
  });

// Card-first trial flow, step 2: verify the confirmed SetupIntent server-side, then
// create the trialing subscription with the verified card as its default payment
// method. Every trial therefore starts with a chargeable card already attached, and
// Stripe charges it automatically the moment the trial ends.
export const completeTrialAction = actionClient
  .inputSchema(completeTrialSchema)
  .action(async ({ parsedInput: { teamId, planId, interval, setupIntentId } }) => {
    return withRateLimit(async () => {
      await assertBillingEnabled();

      const session = await requireTeamPermission(teamId, TEAM_PERMISSIONS.ACCESS_BILLING);

      // Eligibility is checked when the persisted attempt is acquired inside the service.
      // Doing it here would reject the retained reservation needed to resume an ambiguous
      // Stripe request with its stable idempotency key.
      const trialDays = getPlan(planId).trialDays ?? 0;
      if (trialDays <= 0) {
        throw new ActionError("PRECONDITION_FAILED", { key: "Client.Dashboard.Billing.errorTrialUnavailable" });
      }

      try {
        await completeTrialSubscription({
          teamId,
          userId: session.user.id,
          actingUserEmail: session.user.email,
          planId,
          interval,
          setupIntentId,
          trialDays,
        });

        return { success: true };
      } catch (error) {
        if (error instanceof ActionError) {
          throw error;
        }
        console.error("completeTrialAction failed", error);
        throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Dashboard.Billing.errorPaymentProvider" });
      }
    }, RATE_LIMITS.BILLING);
  });

export const changePlanAction = actionClient
  .inputSchema(changePlanSchema)
  .action(async ({ parsedInput: { teamId, planId, interval } }) => {
    return withRateLimit(async () => {
      const { stripe, subscriptionId } = await requireExistingSubscription(teamId);

      try {
        const current = await stripe.subscriptions.retrieve(subscriptionId);

        // A past_due/incomplete/unpaid subscription must settle its open payment first;
        // otherwise the price swap piles prorations onto a team that is still locked out.
        if (!getStripeSubscriptionTransitionPolicy(current.status)?.grantsPaidAccess) {
          throw new ActionError("PRECONDITION_FAILED", { key: "Client.Dashboard.Billing.errorPlanChangeRequiresPaidAccess" });
        }

        // Swap only the PLAN item; add-on items ride along untouched — except on a
        // month<->year switch, where every item must move to its matching-interval
        // price (Stripe rejects mixed intervals on one subscription).
        const classified = classifySubscriptionItems(current);
        const planItem = resolvePlanItem(classified);

        const items: Stripe.SubscriptionUpdateParams.Item[] = [
          { id: planItem?.id, price: getPlanPriceId({ planId, interval }) },
        ];
        for (const { item, addonId } of classified.addonItems) {
          if (item.price?.recurring?.interval !== interval) {
            items.push({
              id: item.id,
              price: getAddonPriceId({ addonId, interval }),
              quantity: item.quantity ?? 1,
            });
          }
        }

        const updated = await stripe.subscriptions.update(subscriptionId, {
          items,
          proration_behavior: "create_prorations",
        });

        // Optimistically reconcile so the UI updates without waiting for the webhook.
        await reconcileTeamFromSubscription({ subscription: updated });

        return { success: true };
      } catch (error) {
        if (error instanceof ActionError) {
          throw error;
        }
        console.error("changePlanAction failed", error);
        throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Dashboard.Billing.errorPaymentProvider" });
      }
    }, RATE_LIMITS.BILLING);
  });

// Sets the ABSOLUTE quantity of one add-on on the team's subscription: adds the item on
// first purchase, updates its quantity, or deletes it at 0. Prorations land on the next
// invoice, so no payment confirmation step is needed here.
export const updateAddonQuantityAction = actionClient
  .inputSchema(updateAddonQuantitySchema)
  .action(async ({ parsedInput: { teamId, addonId, quantity } }) => {
    return withRateLimit(async () => {
      const { stripe, subscriptionId } = await requireExistingSubscription(teamId);

      const addon = getAddon(addonId);
      if (!addon) {
        throw new ActionError("PRECONDITION_FAILED", { key: "Client.Dashboard.Billing.errorAddonUnavailable" });
      }
      if (quantity > getAddonMaxQuantity(addon)) {
        throw new ActionError("PRECONDITION_FAILED", { key: "Client.Dashboard.Billing.errorAddonMaxQuantity", params: { max: getAddonMaxQuantity(addon) } });
      }

      try {
        const current = await stripe.subscriptions.retrieve(subscriptionId);

        // Add-ons ride on a subscription that grants paid access; a past_due/unpaid/
        // paused subscription must settle its plan payment first.
        if (!getStripeSubscriptionTransitionPolicy(current.status)?.grantsPaidAccess) {
          throw new ActionError("PRECONDITION_FAILED", { key: "Client.Dashboard.Billing.addonsRequirePaidPlan" });
        }

        const classified = classifySubscriptionItems(current);
        // Defensive: operate on the first matching item and drop any duplicates (Stripe
        // rejects same-price duplicates, but items added in the dashboard are untrusted).
        const [primary, ...duplicates] = classified.addonItems.filter((entry) => entry.addonId === addonId);

        if (!primary && quantity === 0) {
          return { success: true };
        }

        const items: Stripe.SubscriptionUpdateParams.Item[] = primary
          ? [quantity === 0 ? { id: primary.item.id, deleted: true } : { id: primary.item.id, quantity }]
          : [{
            // New item: match the subscription's billing interval (all items share one).
            price: getAddonPriceId({
              addonId,
              interval: resolvePlanItem(classified)?.price?.recurring?.interval === "year" ? "year" : "month",
            }),
            quantity,
          }];
        items.push(...duplicates.map(({ item }) => ({ id: item.id, deleted: true })));

        const updated = await stripe.subscriptions.update(subscriptionId, {
          items,
          proration_behavior: "create_prorations",
        });

        // Optimistically reconcile so the UI updates without waiting for the webhook.
        await reconcileTeamFromSubscription({ subscription: updated });

        return { success: true };
      } catch (error) {
        if (error instanceof ActionError) {
          throw error;
        }
        console.error("updateAddonQuantityAction failed", error);
        throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Dashboard.Billing.errorPaymentProvider" });
      }
    }, RATE_LIMITS.BILLING);
  });

export const cancelSubscriptionAction = actionClient
  .inputSchema(cancelSubscriptionSchema)
  .action(async ({ parsedInput: { teamId, atPeriodEnd } }) => {
    return withRateLimit(async () => {
      const { stripe, subscriptionId } = await requireExistingSubscription(teamId);

      try {
        const updated = atPeriodEnd
          ? await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true })
          : await stripe.subscriptions.cancel(subscriptionId);

        // Optimistically reconcile so the UI updates without waiting for the webhook.
        await reconcileTeamFromSubscription({ subscription: updated });

        return { success: true };
      } catch (error) {
        if (error instanceof ActionError) {
          throw error;
        }
        console.error("cancelSubscriptionAction failed", error);
        throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Dashboard.Billing.errorPaymentProvider" });
      }
    }, RATE_LIMITS.BILLING);
  });

// Fetches the open invoice's confirmation_secret so the client can re-confirm a
// past_due / incomplete payment (SCA) via the Payment Element.
export const resumePaymentAction = actionClient
  .inputSchema(teamBillingSchema)
  .action(async ({ parsedInput: { teamId } }) => {
    return withRateLimit(async () => {
      const { stripe, subscriptionId } = await requireExistingSubscription(teamId);

      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["latest_invoice.confirmation_secret"],
      });

      const clientSecret = readClientSecret(subscription);

      if (!clientSecret) {
        throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Dashboard.Billing.errorNoClientSecret" });
      }

      return { success: true, clientSecret };
    }, RATE_LIMITS.BILLING);
  });

// Opens a Stripe Customer Portal session for payment method updates, invoice history,
// and billing details. Plan changes and cancellation stay in-app (see actions above);
// keep them disabled in the portal configuration so there is a single code path.
export const createBillingPortalSessionAction = actionClient
  .inputSchema(teamBillingSchema)
  .action(async ({ parsedInput: { teamId } }) => {
    return withRateLimit(async () => {
      await assertBillingEnabled();
      await requireTeamPermission(teamId, TEAM_PERMISSIONS.ACCESS_BILLING);

      const team = await getDB().query.teamTable.findFirst({ where: { id: teamId } });

      // The portal has nothing to show until the team has a Stripe customer (created on
      // first checkout); the UI hides the button until then.
      if (!team?.stripeCustomerId) {
        throw new ActionError("PRECONDITION_FAILED", { key: "Client.Dashboard.Billing.errorBillingPortal" });
      }

      try {
        const locale = await getLocale();
        // Provisioned by `pnpm stripe:setup`: enables billing-details editing (business
        // name, address, VAT/tax IDs), invoices, and payment method updates. When unset,
        // Stripe falls back to the account's default portal configuration.
        const portalConfigurationId = process.env.STRIPE_PORTAL_CONFIG_ID;

        const portalSession = await getStripe().billingPortal.sessions.create({
          customer: team.stripeCustomerId,
          ...(portalConfigurationId ? { configuration: portalConfigurationId } : {}),
          return_url: `${SITE_URL}/dashboard/teams/${team.slug}/billing`,
          // The template's locales (en/es) are all valid portal locales. Downstream
          // projects adding a locale Stripe doesn't support should map or omit this.
          locale: locale as Stripe.BillingPortal.SessionCreateParams.Locale,
        });

        return { success: true, url: portalSession.url };
      } catch (error) {
        if (error instanceof ActionError) {
          throw error;
        }
        console.error("createBillingPortalSessionAction failed", error);
        throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Dashboard.Billing.errorPaymentProvider" });
      }
    }, RATE_LIMITS.BILLING);
  });

// Read-only polling action: the client calls this after confirmPayment to detect when
// the webhook has flipped the team to `active`.
export const getTeamSubscriptionAction = actionClient
  .inputSchema(teamBillingSchema)
  .action(async ({ parsedInput: { teamId } }) => {
    return getTeamBillingSummary(teamId);
  });
