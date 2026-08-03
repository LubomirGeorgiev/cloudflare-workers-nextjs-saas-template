import "server-only";

import { TEAM_PERMISSIONS } from "@/db/schema";
import type { v } from "@/lib/validation";
import type { teamBillingSchema } from "@/schemas/api/teams.schema";
import { toNullableIsoString } from "@/utils/iso-timestamp";
import { requireTeamPermission } from "@/utils/team-auth";
import { getTeamSubscription } from "@/utils/team-subscription";

type TeamBillingSummary = v.InferOutput<typeof teamBillingSchema>;

/**
 * The one read of a team's plan, shared by the REST route and the client polling action.
 * Self-authorizing on purpose: `getTeamSubscription` is an unauthenticated read helper, so putting
 * the `access_billing` gate here is what stops two callers from disagreeing about who may see it.
 */
export async function getTeamBillingSummary(teamId: string): Promise<TeamBillingSummary> {
  await requireTeamPermission(teamId, TEAM_PERMISSIONS.ACCESS_BILLING);

  const subscription = await getTeamSubscription(teamId);

  return {
    planId: subscription.planId,
    planName: subscription.plan.name,
    status: subscription.status,
    interval: subscription.interval,
    addons: subscription.addons,
    planExpiresAt: toNullableIsoString(subscription.planExpiresAt),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    needsPaymentAction: subscription.needsPaymentAction,
  };
}
