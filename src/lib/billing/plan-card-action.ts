import { mustPayOrCancel } from "@/constants/subscription-lifecycle";

export type PlanCardAction =
  | "none"
  | "cancelNow"
  | "cancelAtPeriodEnd"
  | "cancelScheduled"
  | "switchInterval"
  | "changePlan"
  | "startTrial"
  | "subscribe";

interface PlanCardActionParams {
  canManage: boolean;
  isFree: boolean;
  isCurrent: boolean;
  status: string | null;
  hasActiveSubscription: boolean;
  cancelAtPeriodEnd: boolean;
  matchesCurrentInterval: boolean;
  offersTrial: boolean;
}

// The one button a plan card shows. Every button the card shows must be one the server accepts.
export function selectPlanCardAction(params: PlanCardActionParams): PlanCardAction {
  if (!params.canManage || params.isFree) {
    return "none";
  }
  if (mustPayOrCancel(params.status)) {
    return params.isCurrent ? "cancelNow" : "none";
  }
  if (params.isCurrent && params.hasActiveSubscription) {
    if (params.cancelAtPeriodEnd) {
      return "cancelScheduled";
    }
    return params.matchesCurrentInterval ? "cancelAtPeriodEnd" : "switchInterval";
  }
  if (params.hasActiveSubscription) {
    return "changePlan";
  }
  return params.offersTrial ? "startTrial" : "subscribe";
}
