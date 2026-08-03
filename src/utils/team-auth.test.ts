import { beforeEach, describe, expect, test, vi } from "vitest";

import type { ApiKeyPrincipal } from "@/lib/api/principal";
import { API_SCOPE_NAMES } from "@/lib/api/scopes";

// Real permission value, kept local so the contract test does not pull the Drizzle schema graph.
const PERMISSION = "access_dashboard";
const OWN_TEAM_ID = "team_own";
const OTHER_TEAM_ID = "team_other";
const USER_ID = "user_1";

const {
  assertTeamAudienceMock,
  getActiveTeamMembershipMock,
  requireVerifiedEmailMock,
} = vi.hoisted(() => ({
  assertTeamAudienceMock: vi.fn(),
  getActiveTeamMembershipMock: vi.fn(),
  requireVerifiedEmailMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

// The audience module stays real (the ALS is the thing under test); only the assert is wrapped so
// a test can count how many times the service layer performs it.
vi.mock("@/lib/api/principal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/principal")>();
  assertTeamAudienceMock.mockImplementation(actual.assertTeamAudience);

  return { ...actual, assertTeamAudience: assertTeamAudienceMock };
});

vi.mock("@/utils/auth", () => ({ requireVerifiedEmail: requireVerifiedEmailMock }));
vi.mock("@/utils/team-membership", () => ({
  getActiveTeamMembership: getActiveTeamMembershipMock,
}));

const { runWithPrincipal } = await import("@/lib/api/principal");
const { hasTeamMembership, hasTeamPermission, requireTeamPermission } = await import(
  "@/utils/team-auth"
);

// Every scope granted, so a refusal below can only ever come from the audience under test.
function buildTeamKeyPrincipal(teamId: string): ApiKeyPrincipal {
  return {
    kind: "api-key",
    userId: USER_ID,
    user: { id: USER_ID } as ApiKeyPrincipal["user"],
    teams: [],
    scopes: [...API_SCOPE_NAMES],
    audience: { type: "team", teamId },
    keyId: "akey_1",
  };
}

describe("team-auth audience contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireVerifiedEmailMock.mockResolvedValue({ userId: USER_ID });
    getActiveTeamMembershipMock.mockResolvedValue({ permissions: [PERMISSION] });
  });

  test("the permission probe answers false for a team outside the credential's audience", async () => {
    const result = await runWithPrincipal(
      buildTeamKeyPrincipal(OWN_TEAM_ID),
      () => hasTeamPermission(OTHER_TEAM_ID, PERMISSION),
    );

    expect(result).toBe(false);
    // Soft, like hasTeamMembership: a probe never throws, and never reaches the D1 read.
    expect(assertTeamAudienceMock).not.toHaveBeenCalled();
    expect(getActiveTeamMembershipMock).not.toHaveBeenCalled();
  });

  test("the membership probe answers false for the same case", async () => {
    const result = await runWithPrincipal(
      buildTeamKeyPrincipal(OWN_TEAM_ID),
      () => hasTeamMembership(OTHER_TEAM_ID),
    );

    expect(result).toEqual({ hasAccess: false });
  });

  test("the permission probe still answers for the credential's own team", async () => {
    const result = await runWithPrincipal(
      buildTeamKeyPrincipal(OWN_TEAM_ID),
      () => hasTeamPermission(OWN_TEAM_ID, PERMISSION),
    );

    expect(result).toBe(true);
  });

  test("a cookie session has no audience to narrow", async () => {
    expect(await hasTeamPermission(OTHER_TEAM_ID, PERMISSION)).toBe(true);
    expect(assertTeamAudienceMock).not.toHaveBeenCalled();
  });

  test("require refuses a foreign team with the audience error", async () => {
    await expect(runWithPrincipal(
      buildTeamKeyPrincipal(OWN_TEAM_ID),
      () => requireTeamPermission(OTHER_TEAM_ID, PERMISSION),
    )).rejects.toMatchObject({
      code: "FORBIDDEN",
      messageKey: "Client.Settings.ApiKeys.errorTeamKeyOtherTeam",
    });
  });

  test("require asserts the audience exactly once on the allowed path", async () => {
    const session = await runWithPrincipal(
      buildTeamKeyPrincipal(OWN_TEAM_ID),
      () => requireTeamPermission(OWN_TEAM_ID, PERMISSION),
    );

    expect(session).toEqual({ userId: USER_ID });
    expect(assertTeamAudienceMock).toHaveBeenCalledOnce();
  });

  test("require still rejects a missing permission inside the audience", async () => {
    getActiveTeamMembershipMock.mockResolvedValue({ permissions: [] });

    await expect(runWithPrincipal(
      buildTeamKeyPrincipal(OWN_TEAM_ID),
      () => requireTeamPermission(OWN_TEAM_ID, PERMISSION),
    )).rejects.toMatchObject({
      code: "FORBIDDEN",
      messageKey: "Client.Dashboard.Teams.errorTeamPermissionRequired",
    });
    expect(assertTeamAudienceMock).toHaveBeenCalledOnce();
  });

  test("require rejects an unauthenticated caller before any membership read", async () => {
    requireVerifiedEmailMock.mockResolvedValue(null);

    await expect(requireTeamPermission(OWN_TEAM_ID, PERMISSION)).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
    expect(getActiveTeamMembershipMock).not.toHaveBeenCalled();
  });
});
