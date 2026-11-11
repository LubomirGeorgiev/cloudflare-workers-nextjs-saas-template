import "server-only";

import { eq } from "drizzle-orm";

import type { TeamLimitOverrides } from "@/constants/limit-overrides";
import type { TeamPlanLimits } from "@/constants/plans";
import { getDB } from "@/db";
import { teamTable, type Team } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { v } from "@/lib/validation";
import {
  fromStoredLimitOverrides,
  teamLimitOverridesSchema,
  toStoredLimitOverrides,
} from "@/schemas/limit-overrides.schema";
import { getTeamEntitlements, toEntitlementInput } from "@/utils/entitlements";

// Staff limit overrides of one team. The admin team page and the admin API call these. Not
// self-authorizing, like the rest of `src/lib/admin/`: the caller checks the admin.

type LimitTeamColumns = Pick<
  Team,
  "subscriptionPlanId" | "subscriptionStatus" | "planExpiresAt" | "subscriptionAddonIds" | "limitOverrides"
>;

export interface TeamLimitOverridesView {
  planId: string;
  /** False: a paid plan with no paid access. `planLimits` are the Free limits, and only `appliedOverrides` apply. */
  isActive: boolean;
  /** The plan with its add-ons, before the overrides. */
  planLimits: TeamPlanLimits;
  /** Only the keys that staff set, as stored. */
  overrides: TeamLimitOverrides;
  /** The stored keys in effect now: all of them, or only the restrictions below Free when `isActive` is false. */
  appliedOverrides: TeamLimitOverrides;
  /** True: nothing customer-facing says that the limits are custom. The limits apply either way. */
  hideFromCustomer: boolean;
  /** What the team gets: `planLimits`, with each applied override in place of the plan value. */
  limits: TeamPlanLimits;
}

/** Pure: the admin card of one team row. Every value but the stored keys comes from getTeamEntitlements. */
function resolveTeamLimitOverridesView({ team }: { team: LimitTeamColumns }): TeamLimitOverridesView {
  const input = toEntitlementInput(team);
  const withoutOverrides = getTeamEntitlements({ ...input, limitOverrides: null });
  const withOverrides = getTeamEntitlements(input);
  const stored = fromStoredLimitOverrides(team.limitOverrides);

  return {
    planId: withoutOverrides.plan.id,
    isActive: withoutOverrides.isActive,
    planLimits: withoutOverrides.limits,
    overrides: stored.limits,
    appliedOverrides: withOverrides.appliedLimitOverrides,
    hideFromCustomer: stored.hideFromCustomer,
    limits: withOverrides.limits,
  };
}

export async function loadTeamLimitOverrides({ teamId }: { teamId: string }): Promise<TeamLimitOverridesView> {
  return resolveTeamLimitOverridesView({ team: await readLimitTeam({ teamId }) });
}

/**
 * Staff replace the limit overrides of one team. `overrides` is the full new set: a key that is
 * absent goes back to the plan value, and an empty object removes every override and the flag.
 */
export async function setTeamLimitOverridesAsStaff({
  teamId,
  overrides,
  hideFromCustomer,
  reason,
  staffUserId,
}: {
  teamId: string;
  overrides: TeamLimitOverrides;
  hideFromCustomer: boolean;
  reason: string;
  staffUserId: string;
}): Promise<TeamLimitOverridesView> {
  const team = await readLimitTeam({ teamId });
  const checked = v.parse(teamLimitOverridesSchema, overrides);
  const limitOverrides = toStoredLimitOverrides({ limits: checked, hideFromCustomer });
  await getDB().update(teamTable).set({ limitOverrides }).where(eq(teamTable.id, teamId));

  const before = resolveTeamLimitOverridesView({ team });
  const after = resolveTeamLimitOverridesView({ team: { ...team, limitOverrides } });

  // No admin audit table exists yet, so the structured log line is the audit trail.
  console.info(JSON.stringify({
    event: "team_limit_overrides_set",
    teamId,
    staffUserId,
    previousOverrides: before.overrides,
    previousHideFromCustomer: before.hideFromCustomer,
    overrides: checked,
    hideFromCustomer: after.hideFromCustomer,
    reason,
  }));

  return after;
}

async function readLimitTeam({ teamId }: { teamId: string }) {
  const team = await getDB().query.teamTable.findFirst({
    where: { id: teamId },
    columns: {
      subscriptionPlanId: true,
      subscriptionStatus: true,
      planExpiresAt: true,
      subscriptionAddonIds: true,
      limitOverrides: true,
    },
  });
  if (!team) {
    throw new ActionError("NOT_FOUND", "Team not found");
  }

  return team;
}
