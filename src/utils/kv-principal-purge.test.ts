import { beforeEach, describe, expect, test, vi } from "vitest";

import { OAUTH_GRANT_CACHE_TTL_SECONDS, OAUTH_GRANT_GENERATION_TTL_SECONDS } from "@/constants";

const {
  getCloudflareContextMock,
  getDBMock,
  getUserFromDBMock,
  getUserTeamsWithPermissionsMock,
} = vi.hoisted(() => ({
  getCloudflareContextMock: vi.fn(),
  getDBMock: vi.fn(),
  getUserFromDBMock: vi.fn(),
  getUserTeamsWithPermissionsMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("cloudflare:workers", () => ({
  waitUntil: vi.fn(),
}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

vi.mock("@/utils/cloudflare-context", () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

vi.mock("@/utils/session-user", () => ({
  getUserFromDB: getUserFromDBMock,
  getUserTeamsWithPermissions: getUserTeamsWithPermissionsMock,
}));

const {
  getApiKeySnapshotKey,
  getGrantGenerationKey,
  getGrantSnapshotKey,
  putApiKeySnapshot,
  putGrantSnapshot,
  readGrantSnapshot,
} = await import("@/utils/kv-principal-cache");
const { purgeUserPrincipalCaches } = await import("@/utils/kv-principal-purge");

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
    list: vi.fn(async () => ({ keys: [], list_complete: true })),
  };
}

let kv: ReturnType<typeof createKV>;

const USER_ID = "user_purged";
const OTHER_USER_ID = "user_untouched";

// The only D1 read the purge makes: `api_key_user_id_idx` mapped to the hashes its snapshots use.
function stubApiKeyHashes(hashes: string[]) {
  getDBMock.mockReturnValue({
    select: () => ({ from: () => ({ where: async () => hashes.map((keyHash) => ({ keyHash })) }) }),
  });
}

// Every grant rebuild reads the stamp before it writes, which is the order the model depends on.
async function seedGrant(grantId: string, userId: string) {
  const { generation } = await readGrantSnapshot({ grantId, userId });

  await putGrantSnapshot({ grantId, snapshot: { userId }, generation });
}

describe("purging one user's bearer snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kv = createKV();
    stubApiKeyHashes([]);
    getCloudflareContextMock.mockResolvedValue({ env: { KV_STORE: kv } });
  });

  // The reason invalidation replaced enumeration on the grant side: the session refresh runs on
  // ordinary web traffic, and every enumerating shape it could use billed a KV scan or a read.
  test("a purge writes one stamp, reads nothing, and never lists KV", async () => {
    await purgeUserPrincipalCaches(USER_ID);

    expect(kv.list).not.toHaveBeenCalled();
    expect(kv.get).not.toHaveBeenCalled();
    expect(kv.put).toHaveBeenCalledExactlyOnceWith(
      getGrantGenerationKey(USER_ID),
      expect.any(String),
      { expirationTtl: OAUTH_GRANT_GENERATION_TTL_SECONDS },
    );
  });

  test("a purge invalidates the user's grant snapshots and nobody else's", async () => {
    await seedGrant("grant-1", USER_ID);
    await seedGrant("grant-2", OTHER_USER_ID);

    await purgeUserPrincipalCaches(USER_ID);

    await expect(readGrantSnapshot({ grantId: "grant-1", userId: USER_ID }))
      .resolves.toMatchObject({ snapshot: null });
    await expect(readGrantSnapshot({ grantId: "grant-2", userId: OTHER_USER_ID }))
      .resolves.toMatchObject({ snapshot: { userId: OTHER_USER_ID } });
  });

  test("a snapshot written after the purge is accepted again", async () => {
    await seedGrant("grant-1", USER_ID);
    await purgeUserPrincipalCaches(USER_ID);
    await seedGrant("grant-1", USER_ID);

    await expect(readGrantSnapshot({ grantId: "grant-1", userId: USER_ID }))
      .resolves.toMatchObject({ snapshot: { userId: USER_ID } });
  });

  // The safety property behind "no stamp means usable": the stamp is calibrated to outlive every
  // snapshot written before it, so once it expires nothing predating that purge can still exist.
  test("the stamp outlives any snapshot the purge that wrote it invalidated", () => {
    expect(OAUTH_GRANT_GENERATION_TTL_SECONDS).toBeGreaterThan(OAUTH_GRANT_CACHE_TTL_SECONDS);
  });

  test("an expired stamp does not turn a live snapshot into a miss", async () => {
    await seedGrant("grant-1", USER_ID);
    await purgeUserPrincipalCaches(USER_ID);
    await seedGrant("grant-1", USER_ID);
    kv.store.delete(getGrantGenerationKey(USER_ID));

    await expect(readGrantSnapshot({ grantId: "grant-1", userId: USER_ID }))
      .resolves.toMatchObject({ snapshot: { userId: USER_ID } });
  });

  // The read order the rebuild depends on. A rebuild reads the stamp, then D1; a purge landing in
  // between must leave the snapshot it writes stamped stale, never accepted as current.
  test("a rebuild that raced a purge is stamped stale and rejected", async () => {
    const { generation } = await readGrantSnapshot({ grantId: "grant-1", userId: USER_ID });

    await purgeUserPrincipalCaches(USER_ID);
    await putGrantSnapshot({ grantId: "grant-1", snapshot: { userId: USER_ID }, generation });

    await expect(readGrantSnapshot({ grantId: "grant-1", userId: USER_ID }))
      .resolves.toMatchObject({ snapshot: null });
  });

  // KV has no compare-and-swap, which is exactly why the stamp is a blind write: whichever value
  // lands, both purges are satisfied, because any snapshot older than either is now a mismatch.
  test("concurrent purges cannot lose each other's invalidation", async () => {
    await seedGrant("grant-1", USER_ID);

    await Promise.all([purgeUserPrincipalCaches(USER_ID), purgeUserPrincipalCaches(USER_ID)]);

    await expect(readGrantSnapshot({ grantId: "grant-1", userId: USER_ID }))
      .resolves.toMatchObject({ snapshot: null });
  });

  test("a purge deletes every API-key snapshot D1 lists for the user", async () => {
    stubApiKeyHashes(["keyhash-1", "keyhash-2"]);
    for (const keyHash of ["keyhash-1", "keyhash-2", "keyhash-other"]) {
      await putApiKeySnapshot({ keyHash, snapshot: {} });
    }

    await purgeUserPrincipalCaches(USER_ID);

    expect(kv.store.has(getApiKeySnapshotKey("keyhash-1"))).toBe(false);
    expect(kv.store.has(getApiKeySnapshotKey("keyhash-2"))).toBe(false);
    expect(kv.store.has(getApiKeySnapshotKey("keyhash-other"))).toBe(true);
    expect(kv.list).not.toHaveBeenCalled();
  });

  test("a purge deletes more API-key snapshots than fit in one batch", async () => {
    const hashes = Array.from({ length: 13 }, (_, index) => `keyhash-${index}`);
    stubApiKeyHashes(hashes);
    for (const keyHash of hashes) {
      await putApiKeySnapshot({ keyHash, snapshot: {} });
    }

    await purgeUserPrincipalCaches(USER_ID);

    expect(kv.store.size).toBe(1);
    expect(kv.store.has(getGrantGenerationKey(USER_ID))).toBe(true);
  });

  // Both models run from one call, so a user's two credential kinds can never fall out of step.
  test("one call reaches both credential kinds", async () => {
    stubApiKeyHashes(["keyhash-1"]);
    await putApiKeySnapshot({ keyHash: "keyhash-1", snapshot: {} });
    await seedGrant("grant-1", USER_ID);

    await purgeUserPrincipalCaches(USER_ID);

    expect(kv.store.has(getApiKeySnapshotKey("keyhash-1"))).toBe(false);
    expect(kv.store.has(getGrantSnapshotKey("grant-1"))).toBe(true);
    await expect(readGrantSnapshot({ grantId: "grant-1", userId: USER_ID }))
      .resolves.toMatchObject({ snapshot: null });
  });
});
