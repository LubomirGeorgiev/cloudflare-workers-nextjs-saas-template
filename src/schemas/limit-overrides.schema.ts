import { BAN_REASON_MAX_LENGTH } from "@/constants";
import {
  TEAM_LIMIT_OVERRIDE_BOUNDS,
  type StoredLimitOverrides,
  type TeamLimitOverrides,
} from "@/constants/limit-overrides";
import { TEAM_PLAN_LIMIT_KEYS, type TeamPlanLimits } from "@/constants/plans";
import { minMaxString, v } from "@/lib/validation";
import { idField } from "@/schemas/fields";

// Staff limit overrides of one team: the stored shape, its defensive read, and the admin form.
// Staff tooling is English only, so the messages stay inline.

// The two keys of the stored JSON object.
const STORED_LIMITS_KEY = "limits";
const STORED_HIDE_KEY = "hideFromCustomer";
const NO_STORED_OVERRIDES: StoredLimitOverrides = { limits: {}, hideFromCustomer: false };

type LimitKey = keyof TeamPlanLimits;

function boundedLimit(key: LimitKey) {
  const { min, max } = TEAM_LIMIT_OVERRIDE_BOUNDS[key];

  return v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max));
}

const LIMIT_SCHEMAS = Object.fromEntries(
  TEAM_PLAN_LIMIT_KEYS.map((key) => [key, boundedLimit(key)]),
) as Record<LimitKey, ReturnType<typeof boundedLimit>>;

/** The limits that staff set: any subset of the limit keys, each within its bounds. An unknown key fails. */
export const teamLimitOverridesSchema = v.strictObject(
  Object.fromEntries(
    TEAM_PLAN_LIMIT_KEYS.map((key) => [key, v.optional(LIMIT_SCHEMAS[key])]),
  ) as Record<LimitKey, v.OptionalSchema<ReturnType<typeof boundedLimit>, undefined>>,
);

function isLimitKey(key: string): key is LimitKey {
  return Object.hasOwn(LIMIT_SCHEMAS, key);
}

/**
 * The one reader of `team.limitOverrides`. A bad value never throws: bad JSON gives no override,
 * and a key that is unknown or out of bounds is dropped alone, so that key keeps the plan value.
 */
export function fromStoredLimitOverrides(stored: string | null | undefined): StoredLimitOverrides {
  const value = parseStoredObject(stored);
  if (!value) {
    return NO_STORED_OVERRIDES;
  }

  const { [STORED_LIMITS_KEY]: storedLimits, [STORED_HIDE_KEY]: storedHide, ...unknown } = value;
  const { limits, rejected: rejectedLimits } = readStoredLimits(storedLimits);
  const isHideValid = storedHide === undefined || typeof storedHide === "boolean";
  const rejected = Object.keys(unknown).length + rejectedLimits + (isHideValid ? 0 : 1);
  if (rejected > 0) {
    logInvalidOverrides({ problem: "invalid_keys", keyCount: rejected });
  }

  // The flag has no meaning with no limit, and a missing flag means "visible".
  return { limits, hideFromCustomer: storedHide === true && Object.keys(limits).length > 0 };
}

// Null: no stored value, or text that is not a JSON object.
function parseStoredObject(stored: string | null | undefined): Record<string, unknown> | null {
  if (!stored) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    logInvalidOverrides({ problem: "invalid_json", keyCount: 0 });
    return null;
  }
  if (!isPlainObject(value)) {
    logInvalidOverrides({ problem: "not_an_object", keyCount: 0 });
    return null;
  }

  return value;
}

// Each limit is checked alone, so one bad key does not remove the good keys.
function readStoredLimits(storedLimits: unknown): { limits: TeamLimitOverrides; rejected: number } {
  if (storedLimits === undefined) {
    return { limits: {}, rejected: 0 };
  }
  if (!isPlainObject(storedLimits)) {
    return { limits: {}, rejected: 1 };
  }

  const limits: TeamLimitOverrides = {};
  let rejected = 0;
  for (const [key, limit] of Object.entries(storedLimits)) {
    if (isLimitKey(key) && v.is(LIMIT_SCHEMAS[key], limit)) {
      limits[key] = limit;
    } else {
      rejected += 1;
    }
  }

  return { limits, rejected };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The one rule for a team with no paid access: an override stays only where it is below the Free
 * value, because staff set that restriction on purpose. Every raise goes.
 */
export function limitOverridesWithoutPaidAccess({
  overrides,
  freeLimits,
}: {
  overrides: TeamLimitOverrides;
  freeLimits: TeamPlanLimits;
}): TeamLimitOverrides {
  const kept: TeamLimitOverrides = {};
  for (const key of TEAM_PLAN_LIMIT_KEYS) {
    const limit = overrides[key];
    if (limit !== undefined && limit < freeLimits[key]) {
      kept[key] = limit;
    }
  }

  return kept;
}

/**
 * The overrides that customer-facing code may name: the ones in effect, and none when staff hide
 * them. The limits apply either way; only the statement that they are custom goes.
 */
export function limitOverridesForCustomer({
  applied,
  hideFromCustomer,
}: {
  applied: TeamLimitOverrides;
  hideFromCustomer: boolean;
}): TeamLimitOverrides {
  return hideFromCustomer ? {} : applied;
}

/** The value to write: sorted keys, and null when no limit is set, so equal states store equal text. */
export function toStoredLimitOverrides({ limits, hideFromCustomer }: StoredLimitOverrides): string | null {
  const entries = TEAM_PLAN_LIMIT_KEYS
    .flatMap((key) => (limits[key] === undefined ? [] : [[key, limits[key]] as const]))
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return null;
  }

  return JSON.stringify({
    ...(hideFromCustomer ? { [STORED_HIDE_KEY]: true } : {}),
    [STORED_LIMITS_KEY]: Object.fromEntries(entries),
  });
}

// One line, with no stored text in it: the keys of a bad value can be any string.
function logInvalidOverrides({ problem, keyCount }: { problem: string; keyCount: number }): void {
  console.error(JSON.stringify({ event: "team_limit_overrides_invalid", problem, keyCount }));
}

// --- The admin form -------------------------------------------------------------------------

/** The bounds of one number field in the unit that staff type. Every limit uses the stored unit. */
export function limitOverrideFormBounds(key: LimitKey): { min: number; max: number } {
  return TEAM_LIMIT_OVERRIDE_BOUNDS[key];
}

/** A whole number as staff type it. Empty means "no override". */
function limitOverrideField(key: LimitKey) {
  const { min, max } = limitOverrideFormBounds(key);
  const message = `Use a whole number from ${min} to ${max}, or leave it empty`;

  return v.pipe(
    v.string(),
    v.maxLength(String(max).length, message),
    v.regex(/^\d*$/, message),
    v.check((value) => value === "" || (Number(value) >= min && Number(value) <= max), message),
  );
}

/** The number limits of the form. A fork with a yes/no limit key filters it out here. */
export const LIMIT_OVERRIDE_NUMBER_KEYS = TEAM_PLAN_LIMIT_KEYS;

export const setTeamLimitOverridesSchema = v.object({
  teamId: idField("Team ID is required"),
  ...(Object.fromEntries(
    LIMIT_OVERRIDE_NUMBER_KEYS.map((key) => [key, limitOverrideField(key)]),
  ) as Record<(typeof LIMIT_OVERRIDE_NUMBER_KEYS)[number], ReturnType<typeof limitOverrideField>>),
  hideFromCustomer: v.boolean(),
  // Required: a custom limit with no reason is not something we can explain to the customer later.
  reason: minMaxString({ min: 1, max: BAN_REASON_MAX_LENGTH, minMessage: "A reason is required" }),
});

export type SetTeamLimitOverridesInput = v.InferInput<typeof setTeamLimitOverridesSchema>;

type LimitOverrideFormLimits = Omit<SetTeamLimitOverridesInput, "teamId" | "reason" | "hideFromCustomer">;

/** The overrides that the form values state, in the stored units. */
export function limitOverridesFromForm(values: LimitOverrideFormLimits): TeamLimitOverrides {
  const overrides: TeamLimitOverrides = {};
  for (const key of LIMIT_OVERRIDE_NUMBER_KEYS) {
    if (values[key] !== "") {
      overrides[key] = Number(values[key]);
    }
  }

  return overrides;
}

/** The form values that show the stored overrides. */
export function limitOverridesToForm(overrides: TeamLimitOverrides): LimitOverrideFormLimits {
  return Object.fromEntries(LIMIT_OVERRIDE_NUMBER_KEYS.map((key) => {
    const limit = overrides[key];
    return [key, limit === undefined ? "" : String(limit)];
  })) as Record<(typeof LIMIT_OVERRIDE_NUMBER_KEYS)[number], string>;
}
