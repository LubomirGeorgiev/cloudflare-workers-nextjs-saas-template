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
  deleteApiKeySnapshot,
  deleteGrantSnapshot,
  getApiKeySnapshotKey,
  getGrantGenerationKey,
  getGrantSnapshotKey,
  loadPrincipalIdentity,
  putApiKeySnapshot,
  putGrantSnapshot,
  readApiKeySnapshot,
  readGrantSnapshot,
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
    list: vi.fn(async () => ({ keys: [], list_complete: true })),
  };
}

let kv: ReturnType<typeof createKV>;

const USER_ID = "user_principal";
const GENERATION = "gen-1";

function readStoredGrant(grantId: string): unknown {
  return JSON.parse(kv.store.get(getGrantSnapshotKey(grantId))!);
}

// The two contracts differ in exactly one thing — whether a write carries the stamp its reader
// compares — so each is tested against the bytes it leaves in KV, not against the other.
describe("the grant snapshot contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kv = createKV();
    getCloudflareContextMock.mockResolvedValue({ env: { NEXT_INC_CACHE_KV: kv } });
  });

  test("an envelope round-trips, and keeps the stamp beside the payload", async () => {
    await putGrantSnapshot({
      grantId: "grant-1",
      snapshot: { userId: USER_ID },
      generation: GENERATION,
    });

    const { snapshot } = await readGrantSnapshot<{ userId: string }>({
      grantId: "grant-1",
      userId: USER_ID,
    });

    expect(snapshot).toEqual({ userId: USER_ID });
    // The payload the caller owns comes back untouched: the cache never mixes its stamp into it.
    expect(readStoredGrant("grant-1")).toEqual({
      generation: GENERATION,
      snapshot: { userId: USER_ID },
    });
    expect(kv.put).toHaveBeenCalledWith(
      getGrantSnapshotKey("grant-1"),
      expect.any(String),
      { expirationTtl: OAUTH_GRANT_CACHE_TTL_SECONDS },
    );
  });

  // The reason grants have their own writer: the compiler, not a reviewer, has to reject a write
  // that states no generation, because such an entry is one no purge could ever invalidate.
  test("a grant write cannot omit its generation", () => {
    type GrantWrite = Parameters<typeof putGrantSnapshot>[0];

    // @ts-expect-error - `generation` is required, and `null` is how a caller states "no purge".
    const unstamped: GrantWrite = { grantId: "grant-1", snapshot: { userId: USER_ID } };

    expect(unstamped).toMatchObject({ grantId: "grant-1" });
  });

  test("a write stating no purge is in force is readable", async () => {
    await putGrantSnapshot({ grantId: "grant-1", snapshot: { userId: USER_ID }, generation: null });

    await expect(readGrantSnapshot({ grantId: "grant-1", userId: USER_ID }))
      .resolves.toMatchObject({ snapshot: { userId: USER_ID } });
  });

  // An entry written before the envelope existed has no `snapshot` field. That is a miss and a
  // rebuild, never a half-built value, and it self-heals within one cache TTL.
  test("an entry stored in an older shape reads as a miss", async () => {
    kv.store.set(
      getGrantSnapshotKey("grant-legacy"),
      JSON.stringify({ userId: USER_ID, generation: null }),
    );

    await expect(readGrantSnapshot({ grantId: "grant-legacy", userId: USER_ID }))
      .resolves.toMatchObject({ snapshot: null });
  });

  test("the read returns the stamp a rebuild must carry", async () => {
    kv.store.set(getGrantGenerationKey(USER_ID), GENERATION);

    await expect(readGrantSnapshot({ grantId: "grant-1", userId: USER_ID }))
      .resolves.toEqual({ snapshot: null, generation: GENERATION });
  });

  // The whole comparison rule in one table: the stamp decides, and its absence means no purge is
  // still in force rather than "unknown".
  test.each([
    { stamped: GENERATION, current: GENERATION, usable: true, why: "the stamp still matches" },
    { stamped: "gen-0", current: GENERATION, usable: false, why: "a purge superseded the stamp" },
    { stamped: null, current: null, usable: true, why: "no purge was ever in force" },
    { stamped: null, current: GENERATION, usable: false, why: "the entry predates the purge" },
    { stamped: GENERATION, current: null, usable: true, why: "the stamp expired" },
  ])("a snapshot is usable=$usable when $why", async ({ stamped, current, usable }) => {
    if (current !== null) {
      kv.store.set(getGrantGenerationKey(USER_ID), current);
    }
    await putGrantSnapshot({
      grantId: "grant-1",
      snapshot: { userId: USER_ID },
      generation: stamped,
    });

    const { snapshot } = await readGrantSnapshot({ grantId: "grant-1", userId: USER_ID });

    expect(snapshot === null).toBe(!usable);
  });

  test("deleting one grant leaves the user's other snapshots alone", async () => {
    for (const grantId of ["grant-1", "grant-2"]) {
      await putGrantSnapshot({ grantId, snapshot: { userId: USER_ID }, generation: null });
    }

    await deleteGrantSnapshot({ grantId: "grant-1" });

    expect(kv.store.has(getGrantSnapshotKey("grant-1"))).toBe(false);
    expect(kv.store.has(getGrantSnapshotKey("grant-2"))).toBe(true);
  });
});

describe("the API-key snapshot contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kv = createKV();
    getCloudflareContextMock.mockResolvedValue({ env: { NEXT_INC_CACHE_KV: kv } });
  });

  // Stored bare, with no envelope and no stamp: these entries are invalidated by deletion, so a
  // stamp would only be a field nothing ever reads.
  test("a snapshot round-trips exactly as the caller built it", async () => {
    await putApiKeySnapshot({ keyHash: "keyhash-1", snapshot: { keyId: "akey_1" } });

    await expect(readApiKeySnapshot({ keyHash: "keyhash-1" })).resolves.toEqual({ keyId: "akey_1" });
    expect(JSON.parse(kv.store.get(getApiKeySnapshotKey("keyhash-1"))!)).toEqual({
      keyId: "akey_1",
    });
    expect(kv.put).toHaveBeenCalledWith(
      getApiKeySnapshotKey("keyhash-1"),
      expect.any(String),
      { expirationTtl: API_KEY_CACHE_TTL_SECONDS },
    );
  });

  test("a read of an absent hash is a miss, not a throw", async () => {
    await expect(readApiKeySnapshot({ keyHash: "keyhash-gone" })).resolves.toBeNull();
  });

  test("deleting one hash leaves the user's other snapshots alone", async () => {
    await putApiKeySnapshot({ keyHash: "keyhash-1", snapshot: {} });
    await putApiKeySnapshot({ keyHash: "keyhash-2", snapshot: {} });

    await deleteApiKeySnapshot({ keyHash: "keyhash-1" });

    expect(kv.store.has(getApiKeySnapshotKey("keyhash-1"))).toBe(false);
    expect(kv.store.has(getApiKeySnapshotKey("keyhash-2"))).toBe(true);
  });
});

// The two key spaces share a namespace with sessions and with the OAuth provider, so they may only
// ever be told apart by their prefixes.
test("the two caches never collide on the same credential id", () => {
  expect(getApiKeySnapshotKey("shared-id")).not.toBe(getGrantSnapshotKey("shared-id"));
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
