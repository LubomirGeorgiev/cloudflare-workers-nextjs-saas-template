import { describe, expect, test } from "vitest";

import {
  getNextCreditRefreshAt,
  getOneCalendarMonthAfter,
  getOneCalendarMonthBefore,
  shouldRefreshCreditsFromDate,
} from "@/utils/credit-periods";

describe("credit period helpers", () => {
  test("adds one calendar month while preserving the time of day", () => {
    const date = new Date(2026, 3, 15, 9, 30, 45, 123);

    expect(getOneCalendarMonthAfter(date)).toEqual(new Date(2026, 4, 15, 9, 30, 45, 123));
  });

  test("clamps one month after to the last target-month day", () => {
    const date = new Date(2026, 0, 31, 14, 5, 6, 789);

    expect(getOneCalendarMonthAfter(date)).toEqual(new Date(2026, 1, 28, 14, 5, 6, 789));
  });

  test("uses leap day when clamping February in a leap year", () => {
    const date = new Date(2024, 0, 31, 14, 5, 6, 789);

    expect(getOneCalendarMonthAfter(date)).toEqual(new Date(2024, 1, 29, 14, 5, 6, 789));
  });

  test("subtracts one calendar month while preserving the time of day", () => {
    const date = new Date(2026, 4, 15, 9, 30, 45, 123);

    expect(getOneCalendarMonthBefore(date)).toEqual(new Date(2026, 3, 15, 9, 30, 45, 123));
  });

  test("clamps one month before to the last target-month day", () => {
    const date = new Date(2026, 2, 31, 14, 5, 6, 789);

    expect(getOneCalendarMonthBefore(date)).toEqual(new Date(2026, 1, 28, 14, 5, 6, 789));
  });

  test("requires a refresh when no previous refresh exists", () => {
    expect(shouldRefreshCreditsFromDate(null, new Date(2026, 4, 29))).toBe(true);
  });

  test("does not refresh before the next calendar-month boundary", () => {
    const lastCreditRefreshAt = new Date(2026, 3, 29, 10, 0, 0, 0);
    const currentTime = new Date(2026, 4, 29, 9, 59, 59, 999);

    expect(shouldRefreshCreditsFromDate(lastCreditRefreshAt, currentTime)).toBe(false);
  });

  test("refreshes exactly at the next calendar-month boundary", () => {
    const lastCreditRefreshAt = new Date(2026, 3, 29, 10, 0, 0, 0);
    const currentTime = new Date(2026, 4, 29, 10, 0, 0, 0);

    expect(shouldRefreshCreditsFromDate(lastCreditRefreshAt, currentTime)).toBe(true);
  });

  test("refreshes after the next calendar-month boundary", () => {
    const lastCreditRefreshAt = new Date(2026, 3, 29, 10, 0, 0, 0);
    const currentTime = new Date(2026, 4, 29, 10, 0, 0, 1);

    expect(shouldRefreshCreditsFromDate(lastCreditRefreshAt, currentTime)).toBe(true);
  });

  test("schedules the next refresh immediately when no previous refresh exists", () => {
    const now = new Date(2026, 4, 29, 10, 0, 0, 0);

    expect(getNextCreditRefreshAt({ lastCreditRefreshAt: null, now })).toEqual(now);
  });

  test("schedules the next refresh at the future calendar-month boundary", () => {
    const lastCreditRefreshAt = new Date(2026, 3, 29, 10, 0, 0, 0);
    const now = new Date(2026, 4, 1, 10, 0, 0, 0);

    expect(getNextCreditRefreshAt({ lastCreditRefreshAt, now })).toEqual(
      new Date(2026, 4, 29, 10, 0, 0, 0),
    );
  });

  test("schedules the next refresh immediately when the boundary has passed", () => {
    const lastCreditRefreshAt = new Date(2026, 3, 29, 10, 0, 0, 0);
    const now = new Date(2026, 4, 30, 10, 0, 0, 0);

    expect(getNextCreditRefreshAt({ lastCreditRefreshAt, now })).toEqual(now);
  });
});
