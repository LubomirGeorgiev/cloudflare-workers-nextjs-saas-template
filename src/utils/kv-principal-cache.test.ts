import { beforeEach, describe, expect, test, vi } from "vitest";

import { API_KEY_CACHE_TTL_SECONDS, OAUTH_GRANT_CACHE_TTL_SECONDS } from "@/constants";

const { getCloudflareContextMock, getUserFromDBMock, getUserTeamsWithPermissionsMock } = vi.hoisted(
  () => ({
    getCloudflareContextMock: vi.fn(),
    getUserFromDBMock: vi.fn(),
    getUserTeamsWithPermissionsMock: vi.fn(),
  }),
);

vi.mock("server-only", () => ({}));

vi.mock("@/utils/cloudflare-context", () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

vi.mock("@/utils/session-user", () => ({
  getUserFromDB: getUserFromDBMock,
  getUserTeamsWithPermissions: getUserTeamsWithPermissionsMock,
}));

const {
  API_KEY_CACHE,
  OAUTH_GRANT_CACHE,
  deletePrincipalSnapshot,
  getSnapshotKey,
  loadPrincipalIdentity,
  purgeUserPrincipalCaches,
  putPrincipalSnapshot,
} = await import("@/utils/kv-principal-cache");

function createKV() {
  const store = new Map<string, string>();

  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async ({ prefix }: { prefix: string }) => ({
      keys: [...store.keys()]
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ name })),
    })),
  };
}

let kv: ReturnType<typeof createKV>;

const USER_ID = "user_purged";
const OTHER_USER_ID = "user_untouched";

async function seedSnapshot({
  cache,
  id,
  userId,
  ttlSeconds,
}: {
  cache: typeof API_KEY_CACHE;
  id: string;
  userId: string;
  ttlSeconds: number;
}) {
  await putPrincipalSnapshot({ cache, id, userId, snapshot: { userId }, ttlSeconds });
}

describe("principal snapshot cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kv = createKV();
    getCloudflareContextMock.mockResolvedValue({ env: { NEXT_INC_CACHE_KV: kv } });
  });

  test("writes the snapshot and a user index entry under disjoint prefixes", async () => {
    await seedSnapshot({
      cache: OAUTH_GRANT_CACHE,
      id: "grant-1",
      userId: USER_ID,
      ttlSeconds: OAUTH_GRANT_CACHE_TTL_SECONDS,
    });

    expect(kv.store.has(getSnapshotKey({ cache: OAUTH_GRANT_CACHE, id: "grant-1" }))).toBe(true);
    expect(kv.store.has(`${OAUTH_GRANT_CACHE.userIndexPrefix}${USER_ID}:grant-1`)).toBe(true);
    expect(kv.put).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { expirationTtl: OAUTH_GRANT_CACHE_TTL_SECONDS },
    );
  });

  test("purges both credential kinds for one user and nothing else", async () => {
    await Promise.all([
      seedSnapshot({
        cache: API_KEY_CACHE,
        id: "keyhash-1",
        userId: USER_ID,
        ttlSeconds: API_KEY_CACHE_TTL_SECONDS,
      }),
      seedSnapshot({
        cache: OAUTH_GRANT_CACHE,
        id: "grant-1",
        userId: USER_ID,
        ttlSeconds: OAUTH_GRANT_CACHE_TTL_SECONDS,
      }),
      seedSnapshot({
        cache: OAUTH_GRANT_CACHE,
        id: "grant-2",
        userId: OTHER_USER_ID,
        ttlSeconds: OAUTH_GRANT_CACHE_TTL_SECONDS,
      }),
    ]);

    await purgeUserPrincipalCaches(USER_ID);

    expect(kv.store.has(getSnapshotKey({ cache: API_KEY_CACHE, id: "keyhash-1" }))).toBe(false);
    expect(kv.store.has(getSnapshotKey({ cache: OAUTH_GRANT_CACHE, id: "grant-1" }))).toBe(false);
    // Index entries go with them, so a later purge does not retry a dead id.
    expect([...kv.store.keys()].some((key) => key.includes(USER_ID))).toBe(false);
    expect(kv.store.has(getSnapshotKey({ cache: OAUTH_GRANT_CACHE, id: "grant-2" }))).toBe(true);
  });

  test("purges more credentials than fit in one batch", async () => {
    const grantIds = Array.from({ length: 13 }, (_, index) => `grant-${index}`);

    for (const id of grantIds) {
      await seedSnapshot({
        cache: OAUTH_GRANT_CACHE,
        id,
        userId: USER_ID,
        ttlSeconds: OAUTH_GRANT_CACHE_TTL_SECONDS,
      });
    }

    await purgeUserPrincipalCaches(USER_ID);

    expect(kv.store.size).toBe(0);
  });

  test("a single revocation leaves the rest of the user's snapshots alone", async () => {
    await Promise.all([
      seedSnapshot({
        cache: OAUTH_GRANT_CACHE,
        id: "grant-1",
        userId: USER_ID,
        ttlSeconds: OAUTH_GRANT_CACHE_TTL_SECONDS,
      }),
      seedSnapshot({
        cache: OAUTH_GRANT_CACHE,
        id: "grant-2",
        userId: USER_ID,
        ttlSeconds: OAUTH_GRANT_CACHE_TTL_SECONDS,
      }),
    ]);

    await deletePrincipalSnapshot({ cache: OAUTH_GRANT_CACHE, id: "grant-1", userId: USER_ID });

    expect(kv.store.has(getSnapshotKey({ cache: OAUTH_GRANT_CACHE, id: "grant-1" }))).toBe(false);
    expect(kv.store.has(getSnapshotKey({ cache: OAUTH_GRANT_CACHE, id: "grant-2" }))).toBe(true);
  });

  // The write order is the whole safety argument: KV has no transaction, so the only guarantee
  // available is that a half-finished write lands on the recoverable side.
  test("a failed index write leaves no snapshot behind", async () => {
    kv.put.mockRejectedValueOnce(new Error("kv unavailable"));

    await expect(seedSnapshot({
      cache: OAUTH_GRANT_CACHE,
      id: "grant-1",
      userId: USER_ID,
      ttlSeconds: OAUTH_GRANT_CACHE_TTL_SECONDS,
    })).rejects.toThrow("kv unavailable");

    expect(kv.store.size).toBe(0);
    expect(kv.put).toHaveBeenCalledOnce();
  });

  test("a failed snapshot write leaves an index entry a purge can clean up", async () => {
    kv.put.mockImplementationOnce(async (key: string, value: string) => {
      kv.store.set(key, value);
    });
    kv.put.mockRejectedValueOnce(new Error("kv unavailable"));

    await expect(seedSnapshot({
      cache: OAUTH_GRANT_CACHE,
      id: "grant-1",
      userId: USER_ID,
      ttlSeconds: OAUTH_GRANT_CACHE_TTL_SECONDS,
    })).rejects.toThrow("kv unavailable");

    expect(kv.store.has(getSnapshotKey({ cache: OAUTH_GRANT_CACHE, id: "grant-1" }))).toBe(false);
    expect(kv.store.has(`${OAUTH_GRANT_CACHE.userIndexPrefix}${USER_ID}:grant-1`)).toBe(true);

    // The dangling entry costs one delete of a missing key and then disappears.
    await purgeUserPrincipalCaches(USER_ID);
    expect(kv.store.size).toBe(0);
  });

  test("a failed snapshot delete keeps the index entry so a later purge retries it", async () => {
    await seedSnapshot({
      cache: OAUTH_GRANT_CACHE,
      id: "grant-1",
      userId: USER_ID,
      ttlSeconds: OAUTH_GRANT_CACHE_TTL_SECONDS,
    });
    kv.delete.mockRejectedValueOnce(new Error("kv unavailable"));

    await expect(
      deletePrincipalSnapshot({ cache: OAUTH_GRANT_CACHE, id: "grant-1", userId: USER_ID }),
    ).rejects.toThrow("kv unavailable");

    expect(kv.store.has(getSnapshotKey({ cache: OAUTH_GRANT_CACHE, id: "grant-1" }))).toBe(true);
    expect(kv.store.has(`${OAUTH_GRANT_CACHE.userIndexPrefix}${USER_ID}:grant-1`)).toBe(true);

    await purgeUserPrincipalCaches(USER_ID);
    expect(kv.store.size).toBe(0);
  });

  test("a failed index delete leaves the snapshot already gone", async () => {
    await seedSnapshot({
      cache: OAUTH_GRANT_CACHE,
      id: "grant-1",
      userId: USER_ID,
      ttlSeconds: OAUTH_GRANT_CACHE_TTL_SECONDS,
    });
    kv.delete.mockImplementationOnce(async (key: string) => {
      kv.store.delete(key);
    });
    kv.delete.mockRejectedValueOnce(new Error("kv unavailable"));

    await expect(
      deletePrincipalSnapshot({ cache: OAUTH_GRANT_CACHE, id: "grant-1", userId: USER_ID }),
    ).rejects.toThrow("kv unavailable");

    expect(kv.store.has(getSnapshotKey({ cache: OAUTH_GRANT_CACHE, id: "grant-1" }))).toBe(false);
    expect(kv.store.has(`${OAUTH_GRANT_CACHE.userIndexPrefix}${USER_ID}:grant-1`)).toBe(true);
  });
});

// The rebuild-on-miss read both credential kinds share; each still caches it under its own policy.
describe("loadPrincipalIdentity", () => {
  const user = { id: USER_ID, email: "agent@example.com" };
  const teams = [{ id: "team_1" }];

  beforeEach(() => {
    vi.clearAllMocks();
    getUserFromDBMock.mockResolvedValue(user);
    getUserTeamsWithPermissionsMock.mockResolvedValue(teams);
  });

  test("returns the user with their teams, read in parallel", async () => {
    const identity = await loadPrincipalIdentity(USER_ID);

    expect(identity).toEqual({ user, teams });
    expect(getUserFromDBMock).toHaveBeenCalledWith(USER_ID);
    expect(getUserTeamsWithPermissionsMock).toHaveBeenCalledWith(USER_ID);
  });

  // A deleted user must produce no principal at all, whatever the team read returned.
  test("short-circuits to null when the user is gone", async () => {
    getUserFromDBMock.mockResolvedValue(undefined);

    expect(await loadPrincipalIdentity(USER_ID)).toBeNull();
  });
});
