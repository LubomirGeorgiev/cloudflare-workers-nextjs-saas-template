import { getPlan, type TeamPlan, type TeamPlanLimits } from "@/constants/plans";
import { getStripeSubscriptionTransitionPolicy } from "@/constants/subscription-lifecycle";

// Backstop for lost/delayed webhooks: paid access lapses this long after the recorded
// period end even if the status was never updated. Stripe retries failed webhook
// deliveries for up to 3 days, and every renewal refreshes planExpiresAt, so a healthy
// subscription never comes near this window.
const EXPIRY_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

interface TeamEntitlements {
  plan: TeamPlan;
  // Whether the plan's paid features are currently unlocked. The Free plan is always
  // active; paid plans require a status with paid access in the lifecycle policy.
  isActive: boolean;
  limits: TeamPlanLimits;
}

interface EntitlementInput {
  planId: string | null | undefined;
  subscriptionStatus: string | null | undefined;
  // Recorded subscription period end. Optional: callers without it (e.g. KV sessions)
  // gate on status alone; callers with the team row get the expiry backstop.
  planExpiresAt?: Date | null;
}

// Pure mapping from a team's stored plan + status to its entitlements. Legacy rows with
// a null planId coalesce to Free (see getPlan). Kept dependency-free so it's usable on
// both server and client and trivial to unit test.
export function getTeamEntitlements({
  planId,
  subscriptionStatus,
  planExpiresAt,
}: EntitlementInput): TeamEntitlements {
  const plan = getPlan(planId);
  const freePlan = getPlan("free");

  const isFree = plan.amount === 0;
  const grantsPaidAccess =
    getStripeSubscriptionTransitionPolicy(subscriptionStatus)?.grantsPaidAccess ?? false;
  const withinGrace =
    !planExpiresAt || Date.now() < planExpiresAt.getTime() + EXPIRY_GRACE_MS;

  const isActive = isFree ? true : grantsPaidAccess && withinGrace;

  return { plan, isActive, limits: isActive ? plan.limits : freePlan.limits };
}
