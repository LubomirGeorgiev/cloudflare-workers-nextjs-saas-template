import { describe, expect, test } from "vitest";

import {
  SESSION_FETCH_REASON_POLICIES,
  shouldFetchSession,
} from "./session-fetch-policy";

describe("session fetch policy", () => {
  test("declares passive boundary revalidation behavior in one policy map", () => {
    expect(SESSION_FETCH_REASON_POLICIES.focus).toEqual({
      passive: true,
      showLoading: false,
      refreshOnBoundaryChange: true,
    });
    expect(SESSION_FETCH_REASON_POLICIES.visibility).toEqual({
      passive: true,
      showLoading: false,
      refreshOnBoundaryChange: true,
    });
  });

  test("fetches on initial sync after server hydration", () => {
    expect(shouldFetchSession({
      hasHydratedSessionFromServer: true,
      hasSessionCookie: false,
      lastFetched: new Date("2026-06-01T11:09:18.000Z"),
      reason: "initial",
    })).toBe(true);
  });

  test("skips initial sync for anonymous visits without a session-present cookie", () => {
    expect(shouldFetchSession({
      hasHydratedSessionFromServer: false,
      hasSessionCookie: false,
      lastFetched: null,
      reason: "initial",
    })).toBe(false);
  });

  test("fetches after a session mutation even when the current session is fresh", () => {
    expect(shouldFetchSession({
      hasHydratedSessionFromServer: true,
      hasSessionCookie: false,
      lastFetched: new Date("2026-06-01T11:09:18.000Z"),
      reason: "mutation",
    })).toBe(true);
  });

  test("skips focus revalidation for anonymous visits without a session-present cookie", () => {
    expect(shouldFetchSession({
      hasHydratedSessionFromServer: false,
      hasSessionCookie: false,
      lastFetched: new Date("2026-06-01T11:09:18.000Z"),
      reason: "focus",
    })).toBe(false);
  });

  test("skips visibility revalidation for anonymous visits without a session-present cookie", () => {
    expect(shouldFetchSession({
      hasHydratedSessionFromServer: false,
      hasSessionCookie: false,
      lastFetched: new Date("2026-06-01T11:09:18.000Z"),
      reason: "visibility",
    })).toBe(false);
  });

  test("fetches passive revalidation for server-hydrated sessions without a session-present cookie", () => {
    expect(shouldFetchSession({
      hasHydratedSessionFromServer: true,
      hasSessionCookie: false,
      lastFetched: new Date("2026-06-01T11:09:18.000Z"),
      reason: "focus",
    })).toBe(true);
  });
});
