import { getAddonMaxQuantity, TEAM_ADDONS, type TeamAddonQuantities } from "@/constants/addons";
import { LIMIT_SOURCES, type LimitSource } from "@/constants/limit-overrides";
import { TEAM_PLANS, type TeamPlan } from "@/constants/plans";
import type { ActionErrorMessageKey } from "@/lib/action-error";
import { isFreePlan, selectLimitSource, type TeamEntitlements } from "@/utils/entitlements";

// JS form of `withinSeatCap` (src/lib/teams/team-writes.ts), for the seat counter and the invite dialog.
export function getTeamSeatUsage({
  activeMembers,
  pendingInvitations,
  entitlements,
  addons,
}: TeamSeatUsageInput) {
  const used = activeMembers + pendingInvitations;
  const seats = entitlements.limits.seats;
  // Only the copy goes to the browser: the source would tell the customer about a hidden override.
  const { noticeKey, offersUpgrade } = selectSeatLimitCopy({ entitlements, addons });

  return {
    activeMembers,
    pendingInvitations,
    used,
    limit: seats,
    isFull: used >= seats,
    noticeKey,
    offersUpgrade,
  };
}

/** The seat refusal and notice for the team's seat limit. A key name must not reveal a hidden override. */
export function selectSeatLimitCopy({ entitlements, addons }: SeatLimitInput): SeatLimitCopy {
  const limitSource = selectLimitSource({ entitlements, key: "seats" });
  if (limitSource !== LIMIT_SOURCES.PLAN) {
    return SEAT_LIMIT_COPY[limitSource];
  }

  return PLAN_SEAT_LIMIT_COPY[selectPlanSeatRemedy({ entitlements, addons })];
}

/**
 * How a team at its plan seat limit gets more seats. A lapsed plan has Free limits, so an upgrade
 * (a new subscription) is the fix. Otherwise the plan catalog and the add-on catalog decide.
 */
export function selectPlanSeatRemedy({ entitlements: { plan, isActive }, addons }: SeatLimitInput): PlanSeatRemedy {
  const hasPlanWithMoreSeats = Object.values(TEAM_PLANS).some((candidate) => candidate.limits.seats > plan.limits.seats);

  if (!isActive || hasPlanWithMoreSeats) {
    return PLAN_SEAT_REMEDIES.UPGRADE;
  }

  // A Free team has no subscription to carry add-on items, and no add-on grows past its cap
  // (`getAddonMaxQuantity`).
  const canBuyExtraSeats = !isFreePlan(plan) && Object.values(TEAM_ADDONS).some((addon) =>
    (addon.limits?.seats ?? 0) > 0 && (addons[addon.id] ?? 0) < getAddonMaxQuantity(addon));

  return canBuyExtraSeats ? PLAN_SEAT_REMEDIES.EXTRA_SEATS : PLAN_SEAT_REMEDIES.CONTACT;
}

const PLAN_SEAT_REMEDIES = {
  UPGRADE: "upgrade",
  EXTRA_SEATS: "extra_seats",
  CONTACT: "contact",
} as const;

// Only a plan with more seats makes the upgrade advice true. The top plan sells add-on seats or
// sends the owner to support, so its copy offers no upgrade link.
const PLAN_SEAT_LIMIT_COPY: Record<PlanSeatRemedy, SeatLimitCopy> = {
  [PLAN_SEAT_REMEDIES.UPGRADE]: {
    refusalKey: "Client.Dashboard.Teams.seatLimitReached",
    noticeKey: "seatLimitNotice",
    offersUpgrade: true,
  },
  [PLAN_SEAT_REMEDIES.EXTRA_SEATS]: {
    refusalKey: "Client.Dashboard.Teams.seatLimitReachedExtraSeats",
    noticeKey: "seatLimitNoticeExtraSeats",
    offersUpgrade: false,
  },
  [PLAN_SEAT_REMEDIES.CONTACT]: {
    refusalKey: "Client.Dashboard.Teams.seatLimitReachedContact",
    noticeKey: "seatLimitNoticeContact",
    offersUpgrade: false,
  },
};

// A staff override does not grow with the plan, so its copy never tells the owner to upgrade.
const SEAT_LIMIT_COPY: Record<Exclude<LimitSource, typeof LIMIT_SOURCES.PLAN>, SeatLimitCopy> = {
  [LIMIT_SOURCES.CUSTOM]: {
    refusalKey: "Client.Dashboard.Teams.seatLimitReachedCustom",
    noticeKey: "seatLimitNoticeCustom",
    offersUpgrade: false,
  },
  [LIMIT_SOURCES.HIDDEN_CUSTOM]: {
    refusalKey: "Client.Dashboard.Teams.seatLimitReachedContact",
    noticeKey: "seatLimitNoticeContact",
    offersUpgrade: false,
  },
};

interface SeatLimitCopy {
  /** The ActionError key of the invite refusal. It takes `{ seats }`. */
  refusalKey: ActionErrorMessageKey;
  /** The invite dialog notice in `Client.Dashboard.Teams`. It takes `{ used, limit, pending }`. */
  noticeKey: SeatLimitNoticeKey;
  /** True: the dialog may link to the billing page to upgrade. */
  offersUpgrade: boolean;
}

type SeatLimitNoticeKey =
  | "seatLimitNotice"
  | "seatLimitNoticeExtraSeats"
  | "seatLimitNoticeCustom"
  | "seatLimitNoticeContact";

type PlanSeatRemedy = (typeof PLAN_SEAT_REMEDIES)[keyof typeof PLAN_SEAT_REMEDIES];

interface SeatEntitlements extends Pick<TeamEntitlements, "isActive" | "limits" | "appliedLimitOverrides" | "customerLimitOverrides"> {
  plan: Pick<TeamPlan, "amount" | "limits">;
}

/** The facts that decide the seat copy. `addons` holds the add-on units of the team row. */
interface SeatLimitInput {
  entitlements: SeatEntitlements;
  addons: TeamAddonQuantities;
}

interface TeamSeatUsageInput extends SeatLimitInput {
  activeMembers: number;
  pendingInvitations: number;
}

export type TeamSeatUsage = ReturnType<typeof getTeamSeatUsage>;
