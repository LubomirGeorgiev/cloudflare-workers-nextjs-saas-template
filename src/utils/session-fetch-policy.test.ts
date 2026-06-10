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
      lastFetched: new Date("2026-06-01T11:09:18.000Z"),
      reason: "initial",
    })).toBe(true);
  });

  test("fetches after a session mutation even when the current session is fresh", () => {
    expect(shouldFetchSession({
      hasHydratedSessionFromServer: true,
      lastFetched: new Date("2026-06-01T11:09:18.000Z"),
      reason: "mutation",
    })).toBe(true);
  });

  test("fetches on focus revalidation without a freshness window", () => {
    expect(shouldFetchSession({
      hasHydratedSessionFromServer: true,
      lastFetched: new Date("2026-06-01T11:09:18.000Z"),
      reason: "focus",
    })).toBe(true);
  });

  test("fetches on visibility revalidation without a freshness window", () => {
    expect(shouldFetchSession({
      hasHydratedSessionFromServer: true,
      lastFetched: new Date("2026-06-01T11:09:18.000Z"),
      reason: "visibility",
    })).toBe(true);
  });
});
