import { createTranslator } from "use-intl/core";
import { describe, expect, test } from "vitest";

import { getAddonMaxQuantity, TEAM_ADDONS, type TeamAddonQuantities } from "@/constants/addons";
import { LIMIT_SOURCES, type LimitSource } from "@/constants/limit-overrides";
import { TEAM_PLANS, type TeamPlanLimits } from "@/constants/plans";
import { LOCALES } from "@/i18n/config";
import { loadCatalog } from "@/i18n/message-catalogs";
import { resolveKeyedProblemDetail } from "@/lib/api/error-details";

import { getTeamSeatUsage, selectPlanSeatRemedy, selectSeatLimitCopy } from "./team-seats";

const ALL_SOURCES = Object.values(LIMIT_SOURCES);
const OVERRIDE_SOURCES = ALL_SOURCES.filter((source) => source !== LIMIT_SOURCES.PLAN);
const SEATS = 7;

// Derived from the catalogs, so a fork with other plans keeps the same checks.
const PLANS = Object.values(TEAM_PLANS);
const MAX_PLAN_SEATS = Math.max(...PLANS.map((plan) => plan.limits.seats));
const TOP_PLAN = PLANS.find((plan) => plan.limits.seats === MAX_PLAN_SEATS);
const LOWER_PLAN = PLANS.find((plan) => plan.limits.seats < MAX_PLAN_SEATS);
const SEAT_ADDONS = Object.values(TEAM_ADDONS).filter((addon) => (addon.limits?.seats ?? 0) > 0);
const NO_ADDONS = {};
// Every seat add-on at its cap: the team cannot buy one more seat.
const CAPPED_ADDONS = Object.fromEntries(SEAT_ADDONS.map((addon) => [addon.id, getAddonMaxQuantity(addon)]));
// A plan above the whole catalog: no upgrade exists for it.
const BEYOND_TOP_PLAN = { amount: 1, limits: { seats: MAX_PLAN_SEATS + 1, projects: 1 } };
const ACTIVE = seatLimit({ plan: LOWER_PLAN ?? BEYOND_TOP_PLAN });
const REMEDY_CASES = [
  { name: "a lower plan", input: ACTIVE },
  { name: "a paid top plan", input: seatLimit({ plan: BEYOND_TOP_PLAN }) },
  { name: "a paid top plan at the add-on cap", input: seatLimit({ plan: BEYOND_TOP_PLAN, addons: CAPPED_ADDONS }) },
  { name: "a free top plan", input: seatLimit({ plan: { ...BEYOND_TOP_PLAN, amount: 0 } }) },
];

describe("getTeamSeatUsage", () => {
  test("counts pending invitations as used seats", () => {
    expect(getTeamSeatUsage({ activeMembers: 1, pendingInvitations: 1, ...seatLimit({ plan: ACTIVE.entitlements.plan, seats: 2 }) })).toMatchObject({
      used: 2,
      limit: 2,
      isFull: true,
    });
  });

  test("has a free seat while usage is below the limit", () => {
    expect(getTeamSeatUsage({ activeMembers: 1, pendingInvitations: 0, ...seatLimit({ plan: ACTIVE.entitlements.plan, seats: 2 }) }).isFull).toBe(false);
  });

  test("stays full when a lowered limit is below current usage", () => {
    expect(getTeamSeatUsage({ activeMembers: 3, pendingInvitations: 0, ...seatLimit({ plan: ACTIVE.entitlements.plan, seats: 2 }) }).isFull).toBe(true);
  });

  // The browser gets the copy choice, never the source: "hidden" must not reach the page payload.
  test.each(ALL_SOURCES)("carries the %s copy, not the source", (limitSource) => {
    const input = seatLimit({ plan: ACTIVE.entitlements.plan, limitSource });
    const usage = getTeamSeatUsage({ activeMembers: 1, pendingInvitations: 0, ...input });
    const { noticeKey, offersUpgrade } = selectSeatLimitCopy(input);

    expect(usage).toMatchObject({ noticeKey, offersUpgrade });
    expect(Object.values(usage)).not.toContain(limitSource);
  });
});

describe("selectPlanSeatRemedy", () => {
  test.skipIf(!LOWER_PLAN)("offers an upgrade while a plan with more seats exists", () => {
    expect(selectPlanSeatRemedy(ACTIVE)).toBe("upgrade");
  });

  test.skipIf(!TOP_PLAN)("offers no upgrade on the plan with the most seats", () => {
    expect(selectPlanSeatRemedy(seatLimit({ plan: TOP_PLAN ?? BEYOND_TOP_PLAN }))).not.toBe("upgrade");
  });

  test("sends a paid top plan to the seat add-on when the catalog sells one", () => {
    expect(selectPlanSeatRemedy(seatLimit({ plan: BEYOND_TOP_PLAN }))).toBe(SEAT_ADDONS.length > 0 ? "extra_seats" : "contact");
  });

  // The add-on action refuses a quantity above the cap, so the copy must not offer it.
  test("sends a paid top plan to support when every seat add-on is at its cap", () => {
    expect(selectPlanSeatRemedy(seatLimit({ plan: BEYOND_TOP_PLAN, addons: CAPPED_ADDONS }))).toBe("contact");
  });

  test("sends a free top plan to support, because add-ons need a paid plan", () => {
    expect(selectPlanSeatRemedy(seatLimit({ plan: { ...BEYOND_TOP_PLAN, amount: 0 } }))).toBe("contact");
  });

  test("offers an upgrade for a lapsed plan, which has the Free limits", () => {
    expect(selectPlanSeatRemedy(seatLimit({ plan: BEYOND_TOP_PLAN, isActive: false }))).toBe("upgrade");
  });
});

describe("selectSeatLimitCopy", () => {
  test("offers an upgrade only for a plan limit below the top plan", () => {
    expect(selectSeatLimitCopy(ACTIVE).offersUpgrade).toBe(!!LOWER_PLAN);
    expect(selectSeatLimitCopy(seatLimit({ plan: BEYOND_TOP_PLAN })).offersUpgrade).toBe(false);
    for (const limitSource of OVERRIDE_SOURCES) {
      expect(selectSeatLimitCopy(seatLimit({ plan: ACTIVE.entitlements.plan, limitSource })).offersUpgrade).toBe(false);
    }
  });

  test("gives each source its own refusal and notice", () => {
    const copies = ALL_SOURCES.map((limitSource) => selectSeatLimitCopy(seatLimit({ plan: ACTIVE.entitlements.plan, limitSource })));

    expect(new Set(copies.map((copy) => copy.refusalKey)).size).toBe(ALL_SOURCES.length);
    expect(new Set(copies.map((copy) => copy.noticeKey)).size).toBe(ALL_SOURCES.length);
  });

  // safe-action sends the refusal key to the browser as `reason`, so its name must not say "hidden".
  test("names no override in the hidden keys", () => {
    const { refusalKey, noticeKey } = selectSeatLimitCopy(seatLimit({ plan: ACTIVE.entitlements.plan, limitSource: LIMIT_SOURCES.HIDDEN_CUSTOM }));

    for (const key of [refusalKey, noticeKey]) {
      expect(key).not.toMatch(/custom|hidden|override/i);
    }
  });

  describe.each(LOCALES)("in %s", (locale) => {
    test.each(ALL_SOURCES)("renders the %s refusal and notice with their numbers", async (source: LimitSource) => {
      const t = createTranslator({ locale, messages: await loadCatalog(locale) });
      const { refusalKey, noticeKey } = selectSeatLimitCopy(seatLimit({ plan: ACTIVE.entitlements.plan, limitSource: source }));
      const notice = (pending: number) =>
        t(`Client.Dashboard.Teams.${noticeKey}`, { used: SEATS + 1, limit: SEATS, pending });

      expect(t(refusalKey, { seats: SEATS })).toContain(String(SEATS));
      expect(notice(0)).toContain(String(SEATS + 1));
      // The pending branch exists, or the notice states a wrong fact.
      expect(notice(0)).not.toBe(notice(1));
    });

    // Hidden copy is the custom copy minus the statement that the limit is custom.
    test("words the hidden copy apart from the custom copy", async () => {
      const t = createTranslator({ locale, messages: await loadCatalog(locale) });
      const custom = selectSeatLimitCopy(seatLimit({ plan: ACTIVE.entitlements.plan, limitSource: LIMIT_SOURCES.CUSTOM }));
      const hidden = selectSeatLimitCopy(seatLimit({ plan: ACTIVE.entitlements.plan, limitSource: LIMIT_SOURCES.HIDDEN_CUSTOM }));

      expect(t(hidden.refusalKey, { seats: SEATS })).not.toBe(t(custom.refusalKey, { seats: SEATS }));
    });

    test.each(REMEDY_CASES)("renders the plan refusal and notice for $name", async ({ input }) => {
      const t = createTranslator({ locale, messages: await loadCatalog(locale) });
      const { refusalKey, noticeKey } = selectSeatLimitCopy(input);
      const notice = (pending: number) =>
        t(`Client.Dashboard.Teams.${noticeKey}`, { used: SEATS + 1, limit: SEATS, pending });

      expect(t(refusalKey, { seats: SEATS })).toContain(String(SEATS));
      expect(notice(0)).not.toBe(notice(1));
    });
  });

  // The API detail is fixed English, so it can pin the remedy that each plan case names.
  test.each(REMEDY_CASES)("the plan refusal for $name names a remedy that exists", ({ input }) => {
    const detail = resolveKeyedProblemDetail({
      messageKey: selectSeatLimitCopy(input).refusalKey,
      messageParams: { seats: SEATS },
    });
    const remedy = selectPlanSeatRemedy(input);

    expect(detail).toContain(String(SEATS));
    expect(/upgrade/i.test(detail ?? "")).toBe(remedy === "upgrade");
    expect(/extra seats/i.test(detail ?? "")).toBe(remedy === "extra_seats");
  });

  // The API detail is fixed English prose in error-details.ts, not catalog copy.
  test.each(ALL_SOURCES)("the %s refusal has an API detail that names the seat count", (source) => {
    const detail = resolveKeyedProblemDetail({
      messageKey: selectSeatLimitCopy(seatLimit({ plan: ACTIVE.entitlements.plan, limitSource: source })).refusalKey,
      messageParams: { seats: SEATS },
    });

    expect(detail).toContain(String(SEATS));
    if (source === LIMIT_SOURCES.PLAN) {
      expect(/upgrade/i.test(detail ?? "")).toBe(selectPlanSeatRemedy(ACTIVE) === "upgrade");
    } else {
      expect(detail).not.toMatch(/upgrade the/i);
      expect(detail).toMatch(/contact support/i);
    }
    if (source === LIMIT_SOURCES.HIDDEN_CUSTOM) {
      expect(detail).not.toMatch(/custom/i);
    }
  });
});

/** The seat copy input for a plan, with a staff seat override for each non-plan source. */
function seatLimit({
  plan,
  isActive = true,
  limitSource = LIMIT_SOURCES.PLAN,
  seats = plan.limits.seats,
  addons = NO_ADDONS,
}: {
  plan: { amount: number; limits: TeamPlanLimits };
  isActive?: boolean;
  limitSource?: LimitSource;
  seats?: number;
  addons?: TeamAddonQuantities;
}) {
  const override = limitSource === LIMIT_SOURCES.PLAN ? {} : { seats: SEATS };

  return {
    entitlements: {
      plan,
      isActive,
      limits: { ...plan.limits, seats, ...override },
      appliedLimitOverrides: override,
      customerLimitOverrides: limitSource === LIMIT_SOURCES.CUSTOM ? override : {},
    },
    addons,
  };
}
