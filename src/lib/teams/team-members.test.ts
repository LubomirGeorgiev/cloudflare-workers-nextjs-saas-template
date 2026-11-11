import { beforeEach, describe, expect, test, vi } from "vitest";
import { SYSTEM_ROLES_ENUM, TEAM_PERMISSIONS } from "@/constants/team-roles";
import { LIMIT_SOURCES } from "@/constants/limit-overrides";

const {
  requireTeamPermissionMock,
  getActiveTeamMembershipMock,
  pendingInvitationsFindManyMock,
  membershipsFindManyMock,
  rolesFindManyMock,
  membershipFindFirstMock,
  teamFindFirstMock,
  deleteMock,
  updateAllSessionsOfUserMock,
} = vi.hoisted(() => ({
  teamFindFirstMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  deleteMock: vi.fn(),
  updateAllSessionsOfUserMock: vi.fn(),
  requireTeamPermissionMock: vi.fn(),
  getActiveTeamMembershipMock: vi.fn(),
  pendingInvitationsFindManyMock: vi.fn(),
  membershipsFindManyMock: vi.fn(),
  rolesFindManyMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: <T,>(fn: T) => fn }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn(), isNull: vi.fn(), sql: vi.fn() }));

vi.mock("@/db/schema", () => ({
  teamInvitationTable: {},
  teamMembershipTable: {},
}));

vi.mock("@/db", () => ({
  getDB: () => ({
    query: {
      teamMembershipTable: { findMany: membershipsFindManyMock, findFirst: membershipFindFirstMock },
      teamInvitationTable: { findMany: pendingInvitationsFindManyMock },
      teamRoleTable: { findMany: rolesFindManyMock },
      teamTable: { findFirst: teamFindFirstMock },
    },
    delete: () => ({ where: deleteMock }),
  }),
}));

vi.mock("@/utils/auth", () => ({ requireVerifiedEmail: vi.fn() }));
vi.mock("@/lib/action-error", () => ({ ActionError: class extends Error {} }));
vi.mock("@/utils/team-auth", () => ({ requireTeamPermission: requireTeamPermissionMock }));
vi.mock("@/utils/team-membership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/team-membership")>()),
  getActiveTeamMembership: getActiveTeamMembershipMock,
}));
vi.mock("@/utils/session-user", () => ({ requireNormalizedSessionEmail: vi.fn() }));
vi.mock("@/utils/kv-session", () => ({ updateAllSessionsOfUser: updateAllSessionsOfUserMock }));

const { getTeamMemberManagementData, leaveTeam } = await import("./team-members");
const { getTeamRowEntitlements } = await import("@/utils/entitlements");
const { selectSeatLimitCopy } = await import("./team-seats");

const sampleTeamRow = {
  subscriptionPlanId: null,
  subscriptionStatus: null,
  planExpiresAt: null,
  subscriptionAddonIds: null,
  limitOverrides: null,
};

const samplePendingInvitation = {
  id: "tinv_1",
  email: "invitee@example.com",
  roleId: SYSTEM_ROLES_ENUM.MEMBER,
  isSystemRole: 1,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  expiresAt: new Date("2026-02-01T00:00:00Z"),
};

describe("getTeamMemberManagementData invitation gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTeamPermissionMock.mockResolvedValue({ userId: "u1" });
    membershipsFindManyMock.mockResolvedValue([]);
    rolesFindManyMock.mockResolvedValue([]);
    pendingInvitationsFindManyMock.mockResolvedValue([samplePendingInvitation]);
    teamFindFirstMock.mockResolvedValue(sampleTeamRow);
  });

  test("does not fetch or return pending invitations without INVITE_MEMBERS", async () => {
    // Viewer holds dashboard access only (e.g. a system MEMBER/GUEST) — never the invite PII.
    getActiveTeamMembershipMock.mockResolvedValue({
      permissions: [TEAM_PERMISSIONS.ACCESS_DASHBOARD],
    });

    const result = await getTeamMemberManagementData("team_1");

    expect(pendingInvitationsFindManyMock).not.toHaveBeenCalled();
    expect(teamFindFirstMock).not.toHaveBeenCalled();
    expect(result.pendingInvitations).toEqual([]);
    expect(result.canRevokeInvitations).toBe(false);
    expect(result.seatUsage).toBeNull();
  });

  test("returns pending invitations for a viewer with INVITE_MEMBERS", async () => {
    getActiveTeamMembershipMock.mockResolvedValue({
      permissions: [TEAM_PERMISSIONS.ACCESS_DASHBOARD, TEAM_PERMISSIONS.INVITE_MEMBERS],
    });

    const result = await getTeamMemberManagementData("team_1");

    expect(pendingInvitationsFindManyMock).toHaveBeenCalledTimes(1);
    expect(result.pendingInvitations).toHaveLength(1);
    expect(result.pendingInvitations[0]).toMatchObject({ email: samplePendingInvitation.email });
    expect(result.canRevokeInvitations).toBe(true);
  });

  test("treats a viewer with no active membership as unauthorized", async () => {
    getActiveTeamMembershipMock.mockResolvedValue(null);

    const result = await getTeamMemberManagementData("team_1");

    expect(pendingInvitationsFindManyMock).not.toHaveBeenCalled();
    expect(result.pendingInvitations).toEqual([]);
    expect(result.canRevokeInvitations).toBe(false);
  });

  test("counts only current memberships and pending invitations as used seats", async () => {
    getActiveTeamMembershipMock.mockResolvedValue({
      permissions: [TEAM_PERMISSIONS.ACCESS_DASHBOARD, TEAM_PERMISSIONS.INVITE_MEMBERS],
    });
    const user = { id: "u", firstName: null, lastName: null, email: "u@example.com", avatar: null };
    const membership = { roleId: SYSTEM_ROLES_ENUM.MEMBER, isSystemRole: 1, joinedAt: null, user };
    membershipsFindManyMock.mockResolvedValue([
      { ...membership, id: "m1", userId: "u1", isActive: 1, expiresAt: null },
      { ...membership, id: "m2", userId: "u2", isActive: 0, expiresAt: null },
      { ...membership, id: "m3", userId: "u3", isActive: 1, expiresAt: new Date(Date.now() - 1000) },
    ]);

    const result = await getTeamMemberManagementData("team_1");

    expect(result.seatUsage).toEqual({
      activeMembers: 1,
      pendingInvitations: 1,
      used: 2,
      limit: getTeamRowEntitlements(sampleTeamRow).limits.seats,
      isFull: 2 >= getTeamRowEntitlements(sampleTeamRow).limits.seats,
      ...pickNotice(selectSeatLimitCopy(LIMIT_SOURCES.PLAN)),
    });
  });
});

describe("leaveTeam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTeamPermissionMock.mockResolvedValue({ userId: "u1" });
  });

  test("removes the caller's own membership", async () => {
    membershipFindFirstMock.mockResolvedValue({
      roleId: SYSTEM_ROLES_ENUM.MEMBER,
      isSystemRole: 1,
      user: { email: null },
    });

    await expect(leaveTeam("team_1")).resolves.toEqual({ success: true });
    expect(requireTeamPermissionMock).toHaveBeenCalledWith("team_1", TEAM_PERMISSIONS.ACCESS_DASHBOARD);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(updateAllSessionsOfUserMock).toHaveBeenCalledWith("u1");
  });

  test("refuses to let the owner leave", async () => {
    membershipFindFirstMock.mockResolvedValue({
      roleId: SYSTEM_ROLES_ENUM.OWNER,
      isSystemRole: 1,
      user: { email: null },
    });

    await expect(leaveTeam("team_1")).rejects.toThrow();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

function pickNotice({ noticeKey, offersUpgrade }: { noticeKey: string; offersUpgrade: boolean }) {
  return { noticeKey, offersUpgrade };
}
