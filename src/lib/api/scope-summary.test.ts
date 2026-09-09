import { describe, expect, test } from "vitest";

import { API_SCOPE_NAMES, TEAM_KEY_SCOPES, apiScopeResource } from "@/lib/api/scopes";
import { summarizeApiScopes } from "@/lib/api/scope-summary";

describe("summarizeApiScopes", () => {
  test("the whole catalog reads as full access", () => {
    const summary = summarizeApiScopes({ scopes: [...API_SCOPE_NAMES] });

    expect(summary.isFullAccess).toBe(true);
    expect(summary.isReadOnly).toBe(false);
    expect(summary.scopeCount).toBe(API_SCOPE_NAMES.length);
    expect(summary.resources).toEqual([...new Set(API_SCOPE_NAMES.map(apiScopeResource))]);
  });

  test("a team key holding every team scope is full access for its audience", () => {
    const summary = summarizeApiScopes({ scopes: [...TEAM_KEY_SCOPES], teamId: "team_1" });

    expect(summary.isFullAccess).toBe(true);
  });

  test("the team catalog is not full access on a personal credential", () => {
    const summary = summarizeApiScopes({ scopes: [...TEAM_KEY_SCOPES] });

    expect(summary.isFullAccess).toBe(false);
  });

  test("read actions only make a read-only grant", () => {
    const summary = summarizeApiScopes({ scopes: ["teams:read", "billing:read"] });

    expect(summary.isReadOnly).toBe(true);
    expect(summary.resources).toEqual(["teams", "billing"]);
  });

  test("resources follow catalog order whatever order the grant stores them in", () => {
    const summary = summarizeApiScopes({ scopes: ["billing:read", "teams:write", "profile:read"] });

    expect(summary.resources).toEqual(["profile", "teams", "billing"]);
    expect(summary.scopeCount).toBe(3);
  });

  test("duplicate and unknown scopes still count, and unknown resources come last", () => {
    const summary = summarizeApiScopes({
      scopes: ["reports:export", "teams:read", "teams:read", "audit"],
    });

    expect(summary.scopeCount).toBe(3);
    expect(summary.isFullAccess).toBe(false);
    expect(summary.isReadOnly).toBe(false);
    expect(summary.resources).toEqual(["teams", "audit", "reports"]);
  });

  // The audience guard refuses an account-only scope on a team key, so the whole summary has to
  // read the usable scopes — a count or a read-only badge taken from the stored ones would lie.
  test("a team credential summarizes only the scopes its audience may use", () => {
    const accountOnly = API_SCOPE_NAMES.filter((scope) => !TEAM_KEY_SCOPES.includes(scope));

    const summary = summarizeApiScopes({
      scopes: ["teams:read", ...accountOnly],
      teamId: "team_1",
    });

    expect(summary.scopeCount).toBe(1);
    expect(summary.isReadOnly).toBe(true);
    expect(summary.resources).toEqual(["teams"]);
  });

  test("a team credential holding only account-only scopes summarizes as nothing", () => {
    const accountOnly = API_SCOPE_NAMES.filter((scope) => !TEAM_KEY_SCOPES.includes(scope));

    const summary = summarizeApiScopes({ scopes: accountOnly, teamId: "team_1" });

    expect(summary.scopeCount).toBe(0);
    expect(summary.isFullAccess).toBe(false);
    expect(summary.isReadOnly).toBe(false);
    expect(summary.resources).toEqual([]);
  });

  test("an empty grant is neither full nor read-only", () => {
    const summary = summarizeApiScopes({ scopes: [] });

    expect(summary).toEqual({
      scopeCount: 0,
      isFullAccess: false,
      isReadOnly: false,
      resources: [],
    });
  });
});
