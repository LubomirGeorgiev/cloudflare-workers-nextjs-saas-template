import { createTranslator } from "use-intl/core";
import { describe, expect, test } from "vitest";

import { LIMIT_SOURCES, type LimitSource } from "@/constants/limit-overrides";
import { LOCALES } from "@/i18n/config";
import { loadCatalog } from "@/i18n/message-catalogs";
import { resolveKeyedProblemDetail } from "@/lib/api/error-details";

import { getTeamSeatUsage, selectSeatLimitCopy } from "./team-seats";

const ALL_SOURCES = Object.values(LIMIT_SOURCES);
const OVERRIDE_SOURCES = ALL_SOURCES.filter((source) => source !== LIMIT_SOURCES.PLAN);
const SEATS = 7;

describe("getTeamSeatUsage", () => {
  test("counts pending invitations as used seats", () => {
    expect(getTeamSeatUsage({ activeMembers: 1, pendingInvitations: 1, seats: 2, limitSource: LIMIT_SOURCES.PLAN })).toMatchObject({
      used: 2,
      limit: 2,
      isFull: true,
    });
  });

  test("has a free seat while usage is below the limit", () => {
    expect(getTeamSeatUsage({ activeMembers: 1, pendingInvitations: 0, seats: 2, limitSource: LIMIT_SOURCES.PLAN }).isFull).toBe(false);
  });

  test("stays full when a lowered limit is below current usage", () => {
    expect(getTeamSeatUsage({ activeMembers: 3, pendingInvitations: 0, seats: 2, limitSource: LIMIT_SOURCES.PLAN }).isFull).toBe(true);
  });

  // The browser gets the copy choice, never the source: "hidden" must not reach the page payload.
  test.each(ALL_SOURCES)("carries the %s copy, not the source", (limitSource) => {
    const usage = getTeamSeatUsage({ activeMembers: 1, pendingInvitations: 0, seats: 1, limitSource });
    const { noticeKey, offersUpgrade } = selectSeatLimitCopy(limitSource);

    expect(usage).toMatchObject({ noticeKey, offersUpgrade });
    expect(Object.values(usage)).not.toContain(limitSource);
  });
});

describe("selectSeatLimitCopy", () => {
  test("offers an upgrade only for a plan limit", () => {
    expect(selectSeatLimitCopy(LIMIT_SOURCES.PLAN).offersUpgrade).toBe(true);
    for (const source of OVERRIDE_SOURCES) {
      expect(selectSeatLimitCopy(source).offersUpgrade).toBe(false);
    }
  });

  test("gives each source its own refusal and notice", () => {
    const copies = ALL_SOURCES.map(selectSeatLimitCopy);

    expect(new Set(copies.map((copy) => copy.refusalKey)).size).toBe(ALL_SOURCES.length);
    expect(new Set(copies.map((copy) => copy.noticeKey)).size).toBe(ALL_SOURCES.length);
  });

  // safe-action sends the refusal key to the browser as `reason`, so its name must not say "hidden".
  test("names no override in the hidden keys", () => {
    const { refusalKey, noticeKey } = selectSeatLimitCopy(LIMIT_SOURCES.HIDDEN_CUSTOM);

    for (const key of [refusalKey, noticeKey]) {
      expect(key).not.toMatch(/custom|hidden|override/i);
    }
  });

  describe.each(LOCALES)("in %s", (locale) => {
    test.each(ALL_SOURCES)("renders the %s refusal and notice with their numbers", async (source: LimitSource) => {
      const t = createTranslator({ locale, messages: await loadCatalog(locale) });
      const { refusalKey, noticeKey } = selectSeatLimitCopy(source);
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
      const custom = selectSeatLimitCopy(LIMIT_SOURCES.CUSTOM);
      const hidden = selectSeatLimitCopy(LIMIT_SOURCES.HIDDEN_CUSTOM);

      expect(t(hidden.refusalKey, { seats: SEATS })).not.toBe(t(custom.refusalKey, { seats: SEATS }));
    });
  });

  // The API detail is fixed English prose in error-details.ts, not catalog copy.
  test.each(ALL_SOURCES)("the %s refusal has an API detail that names the seat count", (source) => {
    const detail = resolveKeyedProblemDetail({
      messageKey: selectSeatLimitCopy(source).refusalKey,
      messageParams: { seats: SEATS },
    });

    expect(detail).toContain(String(SEATS));
    if (source === LIMIT_SOURCES.PLAN) {
      expect(detail).toMatch(/upgrade/i);
    } else {
      expect(detail).not.toMatch(/upgrade the/i);
      expect(detail).toMatch(/contact support/i);
    }
    if (source === LIMIT_SOURCES.HIDDEN_CUSTOM) {
      expect(detail).not.toMatch(/custom/i);
    }
  });
});
