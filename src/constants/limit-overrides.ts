import type { TeamPlanLimits } from "@/constants/plans";

// The bounds of a staff limit override for one team. Plain data, so the admin form, the admin
// API, and the read of `team.limitOverrides` use one copy.

/** The plan limits that staff replaced for one team. A key that is absent keeps the plan value. */
export type TeamLimitOverrides = Partial<TeamPlanLimits>;

/** What `team.limitOverrides` holds, as JSON: `{"hideFromCustomer":true,"limits":{"seats":25}}`. */
export interface StoredLimitOverrides {
  limits: TeamLimitOverrides;
  /** True: nothing customer-facing says that the limits are custom. The limits apply either way. */
  hideFromCustomer: boolean;
}

/** Where the value of one limit in effect comes from. Only `plan` grows with a plan upgrade. */
export const LIMIT_SOURCES = {
  PLAN: "plan",
  CUSTOM: "custom",
  // A staff override that customer-facing copy must not name.
  HIDDEN_CUSTOM: "hidden_custom",
} as const;

export type LimitSource = (typeof LIMIT_SOURCES)[keyof typeof LIMIT_SOURCES];

// A Record over the limit keys: a fork that adds a limit key fails typecheck until it sets a bound.
export const TEAM_LIMIT_OVERRIDE_BOUNDS: Record<keyof TeamPlanLimits, { min: number; max: number }> = {
  // A team always has its owner. The session refresh job does about 15 D1 and KV calls for
  // each member in one queue invocation, which allows 1,000.
  seats: { min: 1, max: 50 },
  // The template enforces no project limit. A fork that does sets the ceiling its project list
  // and its writes can serve.
  projects: { min: 0, max: 10_000 },
};
