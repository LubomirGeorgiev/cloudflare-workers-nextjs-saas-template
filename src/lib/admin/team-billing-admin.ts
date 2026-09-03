import "server-only";

import type Stripe from "stripe";

import { getPlan, type BillingInterval, type TeamPlan, type TeamPlanId } from "@/constants/plans";
import { REVENUE_PRESERVING_CANCEL_PARAMS } from "@/constants/subscription-lifecycle";
import { getDB } from "@/db";
import { ActionError } from "@/lib/action-error";
import { getStripe } from "@/lib/stripe";
import {
  reconcileTeamFromSubscription,
  settleRecordedSubscription,
} from "@/utils/team-subscription";

// The one staff-facing cancellation. The ban path and the admin team page both call it, so the
// Stripe parameters, the local reconcile, and the "nothing to cancel" case are decided once.
//
// Deliberately *not* self-authenticating, like the rest of `src/lib/admin/`: the panel authorizes
// with `requireAdmin` and the internal API with `assertAdminPrincipal`.

/** Stripe's marker for a subscription it no longer knows; the same code `settleRecordedSubscription` treats as done. */
const STRIPE_MISSING_RESOURCE_CODE = "resource_missing";

/** Open invoices shown on the ban form; a customer past this is a billing problem of its own. */
const OPEN_INVOICE_QUERY_LIMIT = 100;

export interface TeamOpenInvoices {
  count: number;
  /** Stripe's smallest currency unit, summed across the listed invoices. */
  totalAmount: number;
  /** Null when there are no open invoices, so no currency to name. */
  currency: string | null;
}

export interface TeamBillingRisk {
  teamId: string;
  teamName: string;
  teamSlug: string;
  planId: TeamPlanId;
  plan: TeamPlan;
  interval: BillingInterval | null;
  subscriptionStatus: string | null;
  stripeSubscriptionId: string | null;
  /** Every member of the team, the banned owner included; the UI subtracts them. */
  memberCount: number;
  /**
   * What stops being collected automatically when the subscription is cancelled. Stripe stops
   * `auto_advance` on every finalized invoice of the CUSTOMER, not only the subscription's, so
   * this is the honest number to put in front of staff.
   */
  openInvoices: TeamOpenInvoices;
}

async function readOpenInvoices(stripeCustomerId: string | null): Promise<TeamOpenInvoices> {
  const empty: TeamOpenInvoices = { count: 0, totalAmount: 0, currency: null };

  if (!stripeCustomerId) {
    return empty;
  }

  // A billing read must never break the page it warns on: an unreachable Stripe reports "none
  // known" rather than throwing, and the rest of the impact summary still renders.
  const invoices = await (await getStripe()).invoices
    .list({ customer: stripeCustomerId, status: "open", limit: OPEN_INVOICE_QUERY_LIMIT })
    .catch((error: unknown) => {
      console.error("getTeamBillingRisk: open invoice lookup failed", error);
      return null;
    });

  if (!invoices?.data.length) {
    return empty;
  }

  return {
    count: invoices.data.length,
    totalAmount: invoices.data.reduce((total, invoice) => total + (invoice.amount_due ?? 0), 0),
    currency: invoices.data[0]?.currency ?? null,
  };
}

/** Everything staff must see before they cancel a team's subscription, or ban its owner. */
export async function getTeamBillingRisk({ teamId }: { teamId: string }): Promise<TeamBillingRisk> {
  const db = getDB();

  const team = await db.query.teamTable.findFirst({
    where: { id: teamId },
    columns: {
      id: true,
      name: true,
      slug: true,
      subscriptionPlanId: true,
      subscriptionInterval: true,
      subscriptionStatus: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
    },
    with: { memberships: { columns: { id: true } } },
  });

  if (!team) {
    throw new ActionError("NOT_FOUND", "Team not found");
  }

  const plan = getPlan(team.subscriptionPlanId);

  return {
    teamId: team.id,
    teamName: team.name,
    teamSlug: team.slug,
    planId: plan.id as TeamPlanId,
    plan,
    interval: team.subscriptionInterval ?? null,
    subscriptionStatus: team.subscriptionStatus ?? null,
    stripeSubscriptionId: team.stripeSubscriptionId ?? null,
    memberCount: team.memberships.length,
    openInvoices: await readOpenInvoices(team.stripeCustomerId),
  };
}

interface AdminCancelResult {
  /** False when the team had no subscription to cancel; not an error, and not a retry. */
  cancelled: boolean;
}

/**
 * Cancel a team's subscription immediately, as staff rather than as a member.
 *
 * Idempotent: a subscription Stripe no longer knows counts as cancelled, so the retry job can
 * run twice without failing. `reconcileTeamFromSubscription` is idempotent too, which is why the
 * `customer.subscription.deleted` webhook arriving afterwards is harmless.
 *
 * It never refunds. Cancelling is not refunding — staff who decide a ban was wrong issue the
 * refund by hand in the Stripe dashboard.
 */
export async function cancelTeamSubscriptionAsAdmin({
  teamId,
  reason,
  subscriptionId,
}: {
  teamId: string;
  /** Recorded on Stripe as `cancellation_details.comment`, so it joins the billing record. */
  reason: string;
  /** Pass the id the caller already read; omitted, the team row is read for it. */
  subscriptionId?: string;
}): Promise<AdminCancelResult> {
  const recordedId = subscriptionId ?? (await getDB().query.teamTable.findFirst({
    where: { id: teamId },
    columns: { stripeSubscriptionId: true },
  }))?.stripeSubscriptionId;

  if (!recordedId) {
    return { cancelled: false };
  }

  const cancelled: Stripe.Subscription | null = await (await getStripe()).subscriptions
    .cancel(recordedId, {
      ...REVENUE_PRESERVING_CANCEL_PARAMS,
      cancellation_details: { comment: reason },
    })
    .catch((error: unknown) => {
      if ((error as { code?: string })?.code === STRIPE_MISSING_RESOURCE_CODE) {
        return null;
      }

      throw error;
    });

  if (!cancelled) {
    // Stripe no longer knows this subscription — an earlier retry landed, or somebody cancelled
    // it in the dashboard. `settleRecordedSubscription` is the existing path for exactly that:
    // it confirms the miss and releases the team's slot, so the row stops pointing at a dead id.
    await settleRecordedSubscription({ teamId, recordedSubscriptionId: recordedId });

    return { cancelled: true };
  }

  await reconcileTeamFromSubscription({ subscription: cancelled });

  return { cancelled: true };
}
