import { afterEach, describe, expect, test, vi } from "vitest";

import { TEAM_LIMIT_OVERRIDE_BOUNDS } from "@/constants/limit-overrides";
import { TEAM_PLAN_LIMIT_KEYS, type TeamPlanLimits } from "@/constants/plans";
import { v } from "@/lib/validation";

import {
  fromStoredLimitOverrides,
  LIMIT_OVERRIDE_NUMBER_KEYS,
  limitOverrideFormBounds,
  limitOverridesForCustomer,
  limitOverridesFromForm,
  limitOverridesToForm,
  limitOverridesWithoutPaidAccess,
  setTeamLimitOverridesSchema,
  teamLimitOverridesSchema,
  toStoredLimitOverrides,
} from "./limit-overrides.schema";

function emptyForm() {
  return { teamId: "team_1", ...limitOverridesToForm({}), hideFromCustomer: false, reason: "Deal 1" };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the bounds of a limit override", () => {
  test.each(TEAM_PLAN_LIMIT_KEYS)("%s accepts its minimum and its maximum, and nothing outside them", (key) => {
    const { min, max } = TEAM_LIMIT_OVERRIDE_BOUNDS[key];

    expect(v.is(teamLimitOverridesSchema, { [key]: min })).toBe(true);
    expect(v.is(teamLimitOverridesSchema, { [key]: max })).toBe(true);
    expect(v.is(teamLimitOverridesSchema, { [key]: min - 1 })).toBe(false);
    expect(v.is(teamLimitOverridesSchema, { [key]: max + 1 })).toBe(false);
    expect(v.is(teamLimitOverridesSchema, { [key]: min + 0.5 })).toBe(false);
    expect(v.is(teamLimitOverridesSchema, { [key]: String(min) })).toBe(false);
  });

  test("an empty object and a partial object pass; an unknown key fails", () => {
    expect(v.is(teamLimitOverridesSchema, {})).toBe(true);
    expect(v.is(teamLimitOverridesSchema, { seats: TEAM_LIMIT_OVERRIDE_BOUNDS.seats.max })).toBe(true);
    expect(v.is(teamLimitOverridesSchema, { unknownLimit: 3 })).toBe(false);
  });
});

describe("the stored value", () => {
  const NONE = { limits: {}, hideFromCustomer: false };

  test("a round trip keeps the limits and the flag, with sorted keys", () => {
    const visible = toStoredLimitOverrides({ limits: { seats: 5, projects: 7 }, hideFromCustomer: false });
    const hidden = toStoredLimitOverrides({ limits: { seats: 5, projects: 7 }, hideFromCustomer: true });

    expect(visible).toBe(JSON.stringify({ limits: { projects: 7, seats: 5 } }));
    expect(hidden).toBe(JSON.stringify({ hideFromCustomer: true, limits: { projects: 7, seats: 5 } }));
    expect(fromStoredLimitOverrides(visible)).toEqual({ limits: { projects: 7, seats: 5 }, hideFromCustomer: false });
    expect(fromStoredLimitOverrides(hidden)).toEqual({ limits: { projects: 7, seats: 5 }, hideFromCustomer: true });
  });

  test("no limit stores null, also with the flag, and null reads as no override", () => {
    expect(toStoredLimitOverrides(NONE)).toBeNull();
    expect(toStoredLimitOverrides({ limits: {}, hideFromCustomer: true })).toBeNull();
    expect(fromStoredLimitOverrides(null)).toEqual(NONE);
    expect(fromStoredLimitOverrides(undefined)).toEqual(NONE);
    expect(fromStoredLimitOverrides("")).toEqual(NONE);
  });

  test("a missing flag means visible, and a flag with no limit means nothing", () => {
    expect(fromStoredLimitOverrides(JSON.stringify({ limits: { seats: 5 } })).hideFromCustomer).toBe(false);
    expect(fromStoredLimitOverrides(JSON.stringify({ hideFromCustomer: true, limits: {} }))).toEqual(NONE);
    expect(fromStoredLimitOverrides(JSON.stringify({ hideFromCustomer: true }))).toEqual(NONE);
  });

  test.each(["{not json", "[1,2]", "7", "\"text\"", "null"])("the bad value %s reads as no override and logs one line", (stored) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(fromStoredLimitOverrides(stored)).toEqual(NONE);
    expect(log).toHaveBeenCalledTimes(1);
  });

  test.each([
    JSON.stringify({ limits: [5] }),
    JSON.stringify({ limits: "many" }),
    // The shape before the flag: limit keys at the top level.
    JSON.stringify({ seats: 5 }),
  ])("the bad shape %s reads as no override and logs one line", (stored) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(fromStoredLimitOverrides(stored)).toEqual(NONE);
    expect(log).toHaveBeenCalledTimes(1);
  });

  test("a bad key is dropped alone, and the good keys stay", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stored = JSON.stringify({
      limits: {
        seats: 5,
        projects: TEAM_LIMIT_OVERRIDE_BOUNDS.projects.max + 1,
        unknownLimit: 3,
      },
      hideFromCustomer: "yes",
      secret: true,
    });

    expect(fromStoredLimitOverrides(stored)).toEqual({ limits: { seats: 5 }, hideFromCustomer: false });
    expect(log).toHaveBeenCalledTimes(1);
    // The line names no stored key: a bad key can be any text.
    expect(String(log.mock.calls[0]?.[0])).not.toContain("unknownLimit");
    expect(String(log.mock.calls[0]?.[0])).not.toContain("secret");
  });
});

// Synthetic Free limits, so the cases do not depend on the catalog of a fork.
describe("the overrides of a team with no paid access", () => {
  const freeLimits: TeamPlanLimits = { seats: 2, projects: 10 };

  test("a raise above the Free value is dropped", () => {
    expect(limitOverridesWithoutPaidAccess({ overrides: { seats: 25, projects: 11 }, freeLimits })).toEqual({});
  });

  test("a restriction below the Free value stays", () => {
    expect(limitOverridesWithoutPaidAccess({ overrides: { seats: 1, projects: 20 }, freeLimits })).toEqual({ seats: 1 });
    expect(limitOverridesWithoutPaidAccess({ overrides: { projects: 0 }, freeLimits })).toEqual({ projects: 0 });
  });

  test("a value equal to the Free value is dropped: it changes nothing", () => {
    expect(limitOverridesWithoutPaidAccess({ overrides: { seats: freeLimits.seats }, freeLimits })).toEqual({});
  });

  test("no override gives no override", () => {
    expect(limitOverridesWithoutPaidAccess({ overrides: {}, freeLimits })).toEqual({});
  });
});

describe("what customer-facing code may name", () => {
  const applied = { seats: 25, projects: 3 };

  test("the overrides in effect, when staff do not hide them", () => {
    expect(limitOverridesForCustomer({ applied, hideFromCustomer: false })).toEqual(applied);
  });

  test("nothing when staff hide them, and nothing when none is in effect", () => {
    expect(limitOverridesForCustomer({ applied, hideFromCustomer: true })).toEqual({});
    expect(limitOverridesForCustomer({ applied: {}, hideFromCustomer: false })).toEqual({});
  });
});

describe("the admin form", () => {
  test("empty fields state no override", () => {
    const parsed = v.parse(setTeamLimitOverridesSchema, emptyForm());

    expect(limitOverridesFromForm(parsed)).toEqual({});
  });

  test("typed values become overrides in the stored units", () => {
    const projects = limitOverrideFormBounds("projects").max;
    const parsed = v.parse(setTeamLimitOverridesSchema, { ...emptyForm(), seats: "5", projects: String(projects) });
    const overrides = limitOverridesFromForm(parsed);

    expect(overrides).toEqual({ seats: 5, projects });
    expect(v.is(teamLimitOverridesSchema, overrides)).toBe(true);
  });

  test("the form shows the stored overrides again", () => {
    const overrides = { seats: 5, projects: 0 };

    expect(limitOverridesFromForm(limitOverridesToForm(overrides))).toEqual(overrides);
  });

  test.each(LIMIT_OVERRIDE_NUMBER_KEYS)("%s refuses a value outside its bounds, and every value the form accepts fits the stored bounds", (key) => {
    const { min, max } = limitOverrideFormBounds(key);
    const parse = (value: string) => v.safeParse(setTeamLimitOverridesSchema, { ...emptyForm(), [key]: value });

    expect(parse(String(max + 1)).success).toBe(false);
    expect(parse("-1").success).toBe(false);
    expect(parse("1.5").success).toBe(false);
    expect(parse("abc").success).toBe(false);
    if (min > 0) {
      expect(parse(String(min - 1)).success).toBe(false);
    }
    for (const value of [min, max]) {
      const result = parse(String(value));
      expect(result.success).toBe(true);
      expect(result.success && v.is(teamLimitOverridesSchema, limitOverridesFromForm(result.output))).toBe(true);
    }
  });

  test("the reason is required", () => {
    expect(v.safeParse(setTeamLimitOverridesSchema, { ...emptyForm(), reason: "" }).success).toBe(false);
  });
});
