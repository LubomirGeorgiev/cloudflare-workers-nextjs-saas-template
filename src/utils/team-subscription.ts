import "server-only";

import type Stripe from "stripe";
import { env } from "cloudflare:workers";
import { cache } from "react";
import { and, eq, isNull, or } from "drizzle-orm";

import { getStripe } from "@/lib/stripe";
import { getDB } from "@/db";
import { teamTable, userTable } from "@/db/schema";
import { createScheduledQueueMessage, SCHEDULED_JOB_TYPES } from "@/lib/scheduler/jobs";
import { addonQuantitiesFromItems, classifySubscriptionItems, resolvePlanItem, type ClassifiedSubscriptionItems } from "@/utils/subscription-items";
import { DEFAULT_PLAN_ID, getPlan, type BillingInterval, type TeamPlan, type TeamPlanId } from "@/constants/plans";
import { fromStoredAddonQuantities, toStoredAddonQuantities, type TeamAddonQuantities } from "@/constants/addons";
import { getStripeSubscriptionTransitionPolicy } from "@/constants/subscription-lifecycle";

// The item whose period/interval describes the subscription: the plan item when one
// resolves, otherwise the first item (all items share an interval on one subscription,
// so an add-on-only fallback still reads correctly).
function getAnchorItem(
  subscription: Stripe.Subscription,
  classified: ClassifiedSubscriptionItems,
): Stripe.SubscriptionItem | null {
  return resolvePlanItem(classified) ?? subscription.items?.data?.[0] ?? null;
}

// On the current Stripe API version the billing period lives on subscription ITEMS,
// not on the subscription object (`sub.current_period_end` was removed in basil+).
function getSubscriptionPeriodEnd(anchorItem: Stripe.SubscriptionItem | null): Date | null {
  const periodEnd = anchorItem?.current_period_end;
  return periodEnd ? new Date(periodEnd * 1000) : null;
}

// Narrows Stripe's recurring interval (day/week/month/year) to the two the app sells.
function getSubscriptionInterval(anchorItem: Stripe.SubscriptionItem | null): BillingInterval | null {
  const interval = anchorItem?.price?.recurring?.interval;
  return interval === "month" || interval === "year" ? interval : null;
}

function getCustomerId(customer: Stripe.Subscription["customer"]): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

interface EnsureStripeCustomerParams {
  teamId: string;
  actingUserEmail?: string | null;
}

interface TeamSubscriptionSlotParams {
  teamId: string;
  subscriptionId: string;
}

// Atomically claims the team's single subscription slot for a just-created subscription.
// Concurrent subscribes each create an incomplete subscription; exactly one claim wins.
// A false return means another attempt holds the slot — the caller must cancel its
// subscription and converge on the winner's.
export async function claimTeamSubscription({
  teamId,
  subscriptionId,
}: TeamSubscriptionSlotParams): Promise<boolean> {
  const db = getDB();

  const [claimed] = await db
    .update(teamTable)
    .set({ stripeSubscriptionId: subscriptionId })
    .where(and(
      eq(teamTable.id, teamId),
      or(
        isNull(teamTable.stripeSubscriptionId),
        // A webhook may have recorded this same subscription first; that is still a win.
        eq(teamTable.stripeSubscriptionId, subscriptionId),
      ),
    ))
    .returning({ id: teamTable.id });

  return Boolean(claimed);
}

// Releases the slot when Stripe no longer knows the recorded subscription (e.g. deleted
// in the dashboard). Conditional so a concurrently claimed replacement is never cleared.
export async function releaseTeamSubscription({
  teamId,
  subscriptionId,
}: TeamSubscriptionSlotParams): Promise<void> {
  const db = getDB();

  await db
    .update(teamTable)
    .set({ stripeSubscriptionId: null, subscriptionStatus: null })
    .where(and(
      eq(teamTable.id, teamId),
      eq(teamTable.stripeSubscriptionId, subscriptionId),
    ));
}

// Idempotent: reuses the team's existing Stripe customer, otherwise creates one and
// atomically claims the team field. Falls back to the acting user's email since
// `billingEmail` has no write path yet.
export async function ensureStripeCustomer({
  teamId,
  actingUserEmail,
}: EnsureStripeCustomerParams): Promise<string> {
  const db = getDB();
  const team = await db.query.teamTable.findFirst({ where: { id: teamId } });

  if (!team) {
    throw new Error(`Team not found: ${teamId}`);
  }

  if (team.stripeCustomerId) {
    return team.stripeCustomerId;
  }

  const customer = await getStripe().customers.create({
    email: team.billingEmail ?? actingUserEmail ?? undefined,
    name: team.name,
    metadata: { teamId },
  });

  const [claimedTeam] = await db
    .update(teamTable)
    .set({ stripeCustomerId: customer.id })
    .where(and(eq(teamTable.id, teamId), isNull(teamTable.stripeCustomerId)))
    .returning({ stripeCustomerId: teamTable.stripeCustomerId });

  if (claimedTeam?.stripeCustomerId) {
    return claimedTeam.stripeCustomerId;
  }

  const canonicalTeam = await db.query.teamTable.findFirst({ where: { id: teamId } });

  if (!canonicalTeam?.stripeCustomerId) {
    throw new Error(`Could not persist Stripe customer for team: ${teamId}`);
  }

  return canonicalTeam.stripeCustomerId;
}

// One free trial per team AND per user: the team stamp stops re-trialing the same team,
// the user stamp stops farming trials by creating fresh teams. Stripe dashboard-granted
// trials bypass this on purpose (support can always comp a customer).
export async function isTrialEligible({
  teamId,
  userId,
}: {
  teamId: string;
  userId: string;
}): Promise<boolean> {
  const db = getDB();
  const [team, user] = await Promise.all([
    db.query.teamTable.findFirst({ where: { id: teamId } }),
    db.query.userTable.findFirst({ where: { id: userId } }),
  ]);

  return Boolean(team) && !team?.trialUsedAt && !user?.trialUsedAt;
}

// Stamps the acting user when they start a trial. Conditional so the first trial's
// date is never overwritten.
export async function markUserTrialUsed(userId: string): Promise<void> {
  const db = getDB();

  await db
    .update(userTable)
    .set({ trialUsedAt: new Date() })
    .where(and(eq(userTable.id, userId), isNull(userTable.trialUsedAt)));
}

// Refreshing member sessions fans out to D1 + KV work per member — far too slow to run
// inline in a webhook Stripe expects to ack quickly. Offload it to the scheduler queue.
async function enqueueTeamSessionsRefresh(teamId: string): Promise<void> {
  await env.SCHEDULER_QUEUE.send(createScheduledQueueMessage({
    type: SCHEDULED_JOB_TYPES.TEAM_SESSIONS_REFRESH,
    payload: { teamId },
    runAt: new Date(),
  }));
}

interface ReconcileParams {
  // A fresh subscription snapshot fetched from Stripe (source of truth).
  subscription: Stripe.Subscription;
}

// Writes the Stripe subscription snapshot onto the team row. Because the caller passes
// a freshly-fetched subscription, replays and out-of-order webhooks converge to the same
// state (idempotent). Returns the affected teamId (or null if no team matched).
export async function reconcileTeamFromSubscription({
  subscription,
}: ReconcileParams): Promise<string | null> {
  const db = getDB();

  const metadataTeamId = subscription.metadata?.teamId;
  let team = metadataTeamId
    ? await db.query.teamTable.findFirst({ where: { id: metadataTeamId } })
    : undefined;

  if (!team) {
    const customerId = getCustomerId(subscription.customer);
    if (customerId) {
      team = await db.query.teamTable.findFirst({
        where: { stripeCustomerId: customerId },
      });
    }
  }

  if (!team) {
    return null;
  }

  const policy = getStripeSubscriptionTransitionPolicy(subscription.status);
  if (!policy) {
    throw new Error(`Unsupported Stripe subscription status: ${subscription.status}`);
  }

  // Snapshots for a subscription other than the team's current one — a replaced
  // predecessor's late webhook, or the loser of a concurrent checkout race — must
  // never clobber the current reference. Ignore them entirely.
  if (team.stripeSubscriptionId && team.stripeSubscriptionId !== subscription.id) {
    return team.id;
  }

  const cancelAtPeriodEnd = subscription.cancel_at_period_end ? 1 : 0;

  if (policy.plan === "free") {
    await db
      .update(teamTable)
      .set({
        subscriptionPlanId: DEFAULT_PLAN_ID,
        stripeSubscriptionId: policy.subscription === "clear" ? null : subscription.id,
        subscriptionStatus: policy.statusWrite === "clear" ? null : subscription.status,
        subscriptionInterval: null,
        subscriptionAddonIds: null,
        cancelAtPeriodEnd,
        planExpiresAt: null,
      })
      .where(eq(teamTable.id, team.id));
  } else {
    const classified = classifySubscriptionItems(subscription);
    const anchorItem = getAnchorItem(subscription, classified);
    const planId = classified.planId ?? team.subscriptionPlanId ?? DEFAULT_PLAN_ID;

    // Unknown items mean this deployment can't fully interpret the subscription
    // (rotated price envs, or items added in the Stripe dashboard). Keep going with the
    // fallbacks above, but say so — silence here would mislabel billing state quietly.
    if (classified.unknownItems.length) {
      console.warn("reconcileTeamFromSubscription: unrecognized subscription item prices", {
        subscriptionId: subscription.id,
        priceIds: classified.unknownItems.map((item) => item.price?.id ?? null),
      });
    }

    await db
      .update(teamTable)
      .set({
        stripeSubscriptionId: subscription.id,
        subscriptionPlanId: planId,
        subscriptionStatus: subscription.status,
        subscriptionInterval: getSubscriptionInterval(anchorItem),
        subscriptionAddonIds: toStoredAddonQuantities(addonQuantitiesFromItems(classified)),
        cancelAtPeriodEnd,
        planExpiresAt: getSubscriptionPeriodEnd(anchorItem),
        // A team gets one free trial ever; stamp the first time Stripe reports `trialing`
        // (covers both app-created trials and ones granted in the Stripe dashboard).
        ...(subscription.status === "trialing" && !team.trialUsedAt
          ? { trialUsedAt: new Date() }
          : {}),
      })
      .where(eq(teamTable.id, team.id));
  }

  await enqueueTeamSessionsRefresh(team.id);

  return team.id;
}

interface TeamSubscriptionView {
  planId: TeamPlanId;
  plan: TeamPlan;
  status: Stripe.Subscription.Status | null;
  // Billing interval of the current subscription; null when free or unknown (legacy rows).
  interval: BillingInterval | null;
  // Active add-on units per add-on id (empty when free or none configured).
  addons: TeamAddonQuantities;
  planExpiresAt: Date | null;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  needsPaymentAction: boolean;
}

// Read helper for the billing UI. Reads only the local snapshot: Stripe is the source
// of truth, but webhooks + action-side reconciles keep the team row current, so reads
// (including the post-checkout activation poll) never need a live Stripe call.
export const getTeamSubscription = cache(async (teamId: string): Promise<TeamSubscriptionView> => {
  const db = getDB();
  const team = await db.query.teamTable.findFirst({ where: { id: teamId } });

  const plan = getPlan(team?.subscriptionPlanId);

  return {
    planId: plan.id as TeamPlanId,
    plan,
    status: team?.subscriptionStatus ?? null,
    interval: team?.subscriptionInterval ?? null,
    addons: fromStoredAddonQuantities(team?.subscriptionAddonIds),
    planExpiresAt: team?.planExpiresAt ?? null,
    stripeSubscriptionId: team?.stripeSubscriptionId ?? null,
    cancelAtPeriodEnd: Boolean(team?.cancelAtPeriodEnd),
    needsPaymentAction: getStripeSubscriptionTransitionPolicy(team?.subscriptionStatus)?.needsPaymentAction ?? false,
  };
});
