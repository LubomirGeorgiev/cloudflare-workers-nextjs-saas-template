import { TEAM_LIMIT_OVERRIDE_BOUNDS, type TeamLimitOverrides } from "@/constants/limit-overrides";
import { DEFAULT_PLAN_ID, TEAM_PLANS, TEAM_PLAN_LIMIT_KEYS } from "@/constants/plans";
import { toStoredLimitOverrides } from "@/schemas/limit-overrides.schema";

// A custom deal for the limit override tests, from the catalog and the bounds, so a fork passes:
// one key above the Free value, and one other key below it.

const FREE_LIMITS = TEAM_PLANS[DEFAULT_PLAN_ID].limits;
const raiseKey = TEAM_PLAN_LIMIT_KEYS.find((key) => TEAM_LIMIT_OVERRIDE_BOUNDS[key].max > FREE_LIMITS[key]);
const restrictionKey = TEAM_PLAN_LIMIT_KEYS.find(
  (key) => key !== raiseKey && TEAM_LIMIT_OVERRIDE_BOUNDS[key].min < FREE_LIMITS[key],
);

/** False in a fork whose Free limits leave no room for a raise and a restriction. */
export const HAS_LIMIT_OVERRIDE_DEAL = Boolean(raiseKey && restrictionKey);

/** An override above the Free value: it goes when paid access ends. */
export const DEAL_RAISE: TeamLimitOverrides = raiseKey ? { [raiseKey]: TEAM_LIMIT_OVERRIDE_BOUNDS[raiseKey].max } : {};

/** An override below the Free value: it stays when paid access ends. */
export const DEAL_RESTRICTION: TeamLimitOverrides = restrictionKey
  ? { [restrictionKey]: TEAM_LIMIT_OVERRIDE_BOUNDS[restrictionKey].min }
  : {};

/** The stored text of a set of limits, as `setTeamLimitOverridesAsStaff` writes it. */
export function storedLimitOverrides(
  limits: TeamLimitOverrides,
  { hideFromCustomer = false }: { hideFromCustomer?: boolean } = {},
): string | null {
  return toStoredLimitOverrides({ limits, hideFromCustomer });
}
