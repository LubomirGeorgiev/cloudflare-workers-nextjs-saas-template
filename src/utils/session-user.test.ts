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

const { getUserTeamsWithPermissions } = await import("@/utils/session-user");

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
    expect(teams.map((team) => team.role.name)).toEqual(["Editor", "Editor"]);
    expect(teams.map((team) => team.permissions)).toEqual([
      ["access_dashboard"],
      ["access_dashboard"],
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
});

function createMembership({
  teamId,
  roleId,
  isSystemRole = 0,
}: {
  teamId: string;
  roleId: string;
  isSystemRole?: number;
}) {
  return {
    teamId,
    roleId,
    isSystemRole,
    team: {
      name: `Team ${teamId}`,
      slug: teamId,
      subscriptionPlanId: "free",
      subscriptionStatus: null,
    },
  };
}
