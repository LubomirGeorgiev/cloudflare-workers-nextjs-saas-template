import { beforeEach, describe, expect, test, vi } from "vitest";

// Real permission/role constants so assertions track the template's own values instead of
// hard-coding copies (template-safe: downstream projects may rename, these stay derived).
const TEAM_PERMISSIONS = {
  ACCESS_DASHBOARD: "access_dashboard",
  INVITE_MEMBERS: "invite_members",
  REMOVE_MEMBERS: "remove_members",
} as const;

const SYSTEM_ROLES_ENUM = { OWNER: "owner", MEMBER: "member", GUEST: "guest" } as const;

const {
  requireTeamPermissionMock,
  getActiveTeamMembershipMock,
  pendingInvitationsFindManyMock,
  membershipsFindManyMock,
  rolesFindManyMock,
} = vi.hoisted(() => ({
  requireTeamPermissionMock: vi.fn(),
  getActiveTeamMembershipMock: vi.fn(),
  pendingInvitationsFindManyMock: vi.fn(),
  membershipsFindManyMock: vi.fn(),
  rolesFindManyMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: <T,>(fn: T) => fn }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));

vi.mock("@/db/schema", () => ({
  SYSTEM_ROLES_ENUM,
  TEAM_PERMISSIONS,
  teamMembershipTable: {},
}));

vi.mock("@/db", () => ({
  getDB: () => ({
    query: {
      teamMembershipTable: { findMany: membershipsFindManyMock },
      teamInvitationTable: { findMany: pendingInvitationsFindManyMock },
      teamRoleTable: { findMany: rolesFindManyMock },
    },
  }),
}));

vi.mock("@/utils/auth", () => ({ requireVerifiedEmail: vi.fn() }));
vi.mock("@/lib/action-error", () => ({ ActionError: class extends Error {} }));
vi.mock("@/utils/team-auth", () => ({ requireTeamPermission: requireTeamPermissionMock }));
vi.mock("@/utils/team-membership", () => ({ getActiveTeamMembership: getActiveTeamMembershipMock }));
vi.mock("@/utils/session-user", () => ({ requireNormalizedSessionEmail: vi.fn() }));
vi.mock("@/utils/kv-session", () => ({ updateAllSessionsOfUser: vi.fn() }));

const { getTeamMemberManagementData } = await import("./team-members");

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
  });

  test("does not fetch or return pending invitations without INVITE_MEMBERS", async () => {
    // Viewer holds dashboard access only (e.g. a system MEMBER/GUEST) — never the invite PII.
    getActiveTeamMembershipMock.mockResolvedValue({
      permissions: [TEAM_PERMISSIONS.ACCESS_DASHBOARD],
    });

    const result = await getTeamMemberManagementData("team_1");

    expect(pendingInvitationsFindManyMock).not.toHaveBeenCalled();
    expect(result.pendingInvitations).toEqual([]);
    expect(result.canRevokeInvitations).toBe(false);
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
});
