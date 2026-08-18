import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  findMembershipsMock,
  getCloudflareContextMock,
  getDBMock,
  getUserFromDBMock,
  getUserTeamsWithPermissionsMock,
  purgeUserPrincipalCachesMock,
} = vi.hoisted(() => ({
  findMembershipsMock: vi.fn(),
  getCloudflareContextMock: vi.fn(),
  getDBMock: vi.fn(),
  getUserFromDBMock: vi.fn(),
  getUserTeamsWithPermissionsMock: vi.fn(),
  purgeUserPrincipalCachesMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/utils/cloudflare-context", () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

vi.mock("@/utils/session-user", () => ({
  getUserFromDB: getUserFromDBMock,
  getUserTeamsWithPermissions: getUserTeamsWithPermissionsMock,
}));

vi.mock("@/utils/kv-principal-purge", () => ({
  purgeUserPrincipalCaches: purgeUserPrincipalCachesMock,
}));

const { refreshTeamMemberSessions, updateAllSessionsOfUser } = await import("@/utils/kv-session");

const USER_ID = "user_1";

function createKV() {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ keys: [] })),
  };
}

let kv: ReturnType<typeof createKV>;

describe("updateAllSessionsOfUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kv = createKV();
    getCloudflareContextMock.mockResolvedValue({ env: { NEXT_INC_CACHE_KV: kv } });
    getUserTeamsWithPermissionsMock.mockResolvedValue([]);
    getDBMock.mockReturnValue({
      query: { teamMembershipTable: { findMany: findMembershipsMock } },
    });
  });

  test("purges bearer snapshots exactly once for a live user", async () => {
    getUserFromDBMock.mockResolvedValue({ id: USER_ID });

    await updateAllSessionsOfUser(USER_ID);

    expect(purgeUserPrincipalCachesMock).toHaveBeenCalledExactlyOnceWith(USER_ID);
  });

  test("still purges bearer snapshots when the user row is gone", async () => {
    getUserFromDBMock.mockResolvedValue(undefined);

    await updateAllSessionsOfUser(USER_ID);

    expect(purgeUserPrincipalCachesMock).toHaveBeenCalledExactlyOnceWith(USER_ID);
    // The session refresh is what short-circuits for a deleted user, not the purge.
    expect(getUserTeamsWithPermissionsMock).not.toHaveBeenCalled();
  });
});

describe("refreshTeamMemberSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kv = createKV();
    getCloudflareContextMock.mockResolvedValue({ env: { NEXT_INC_CACHE_KV: kv } });
    getUserFromDBMock.mockImplementation(async (userId: string) => ({ id: userId }));
    getUserTeamsWithPermissionsMock.mockResolvedValue([]);
    getDBMock.mockReturnValue({
      query: { teamMembershipTable: { findMany: findMembershipsMock } },
    });
  });

  test("purges each member's bearer snapshots exactly once", async () => {
    const memberIds = Array.from({ length: 7 }, (_, index) => `user_${index}`);
    findMembershipsMock.mockResolvedValue(memberIds.map((userId) => ({ userId })));

    await refreshTeamMemberSessions("team_1");

    expect(purgeUserPrincipalCachesMock).toHaveBeenCalledTimes(memberIds.length);
    // Order is unspecified: members are refreshed in concurrent batches.
    expect(purgeUserPrincipalCachesMock.mock.calls.map(([userId]) => userId).sort())
      .toEqual([...memberIds].sort());
  });
});
