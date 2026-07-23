import { beforeEach, describe, expect, test, vi } from "vitest";

const { getDBMock, findMembershipsMock, findRolesMock } = vi.hoisted(() => ({
  getDBMock: vi.fn(),
  findMembershipsMock: vi.fn(),
  findRolesMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

const { getUserTeamsWithPermissions, requireNormalizedSessionEmail } = await import("@/utils/session-user");

describe("requireNormalizedSessionEmail", () => {
  test("returns the trimmed, lowercased email", () => {
    const session = { user: { email: "  Bob@Example.COM " } } as never;
    expect(requireNormalizedSessionEmail(session)).toBe("bob@example.com");
  });

  test("throws when the session has no email", () => {
    const session = { user: { email: null } } as never;
    expect(() => requireNormalizedSessionEmail(session)).toThrow();
  });

  test("throws when the email is an empty string", () => {
    const session = { user: { email: "" } } as never;
    expect(() => requireNormalizedSessionEmail(session)).toThrow();
  });
});

describe("getUserTeamsWithPermissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDBMock.mockReturnValue({
      query: {
        teamMembershipTable: { findMany: findMembershipsMock },
        teamRoleTable: { findMany: findRolesMock },
      },
    });
  });

  test("loads repeated custom roles in one batched query", async () => {
    findMembershipsMock.mockResolvedValue([
      createMembership({ teamId: "team-1", roleId: "role-1" }),
      createMembership({ teamId: "team-2", roleId: "role-1" }),
    ]);
    findRolesMock.mockResolvedValue([{
      id: "role-1",
      teamId: "team-1",
      name: "Editor",
      permissions: [
        "access_dashboard",
        "create_components",
        "edit_components",
        "delete_components",
      ],
    }]);

    const teams = await getUserTeamsWithPermissions("user-1");

    expect(findRolesMock).toHaveBeenCalledOnce();
    expect(findRolesMock).toHaveBeenCalledWith({
      where: { id: { in: ["role-1"] } },
    });
    // The role row belongs to team-1 only; the team-2 membership referencing it must
    // resolve to no permissions (a role from another team never grants access).
    expect(teams.map((team) => team.role.name)).toEqual(["Editor", ""]);
    expect(teams.map((team) => team.permissions)).toEqual([
      ["access_dashboard"],
      [],
    ]);
  });

  test("skips the custom-role query for system-only memberships", async () => {
    findMembershipsMock.mockResolvedValue([
      createMembership({ teamId: "team-1", roleId: "member", isSystemRole: 1 }),
    ]);

    const teams = await getUserTeamsWithPermissions("user-1");

    expect(findRolesMock).not.toHaveBeenCalled();
    expect(teams[0]?.role).toMatchObject({
      id: "member",
      name: "member",
      isSystemRole: true,
    });
    expect(teams[0]?.permissions).toEqual(["access_dashboard"]);
  });

  test("drops inactive and expired memberships during hydration", async () => {
    findMembershipsMock.mockResolvedValue([
      createMembership({ teamId: "team-1", roleId: "member", isSystemRole: 1 }),
      createMembership({ teamId: "team-2", roleId: "member", isSystemRole: 1, isActive: 0 }),
      createMembership({
        teamId: "team-3",
        roleId: "member",
        isSystemRole: 1,
        expiresAt: new Date(Date.now() - 1000),
      }),
    ]);

    const teams = await getUserTeamsWithPermissions("user-1");

    expect(teams.map((team) => team.id)).toEqual(["team-1"]);
  });
});

function createMembership({
  teamId,
  roleId,
  isSystemRole = 0,
  isActive = 1,
  expiresAt = null,
}: {
  teamId: string;
  roleId: string;
  isSystemRole?: number;
  isActive?: number;
  expiresAt?: Date | null;
}) {
  return {
    teamId,
    roleId,
    isSystemRole,
    isActive,
    expiresAt,
    team: {
      name: `Team ${teamId}`,
      slug: teamId,
      subscriptionPlanId: "free",
      subscriptionStatus: null,
    },
  };
}
