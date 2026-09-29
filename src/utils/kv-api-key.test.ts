import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { API_KEY_PREFIX_LIVE, CURRENT_API_KEY_CACHE_VERSION } from "@/constants";
import { API_SCOPE_NAMES } from "@/lib/api/scopes";
import { generateApiKey } from "@/utils/api-key-format";

const {
  findFirst,
  getCloudflareContextMock,
  getUserFromDBMock,
  spanAttributes,
  fakeSpan,
  update,
  updateSet,
} = vi.hoisted(() => {
  const updateWhere = vi.fn(() => Promise.resolve());
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const attributes = new Map<string, unknown>();
  const span = {
    isTraced: true,
    recordException: vi.fn(),
    setAttribute: vi.fn(),
    setAttributes: vi.fn((values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) {
        attributes.set(key, value);
      }

      return span;
    }),
  };

  return {
    findFirst: vi.fn(),
    getCloudflareContextMock: vi.fn(),
    getUserFromDBMock: vi.fn(),
    spanAttributes: attributes,
    fakeSpan: span,
    update: vi.fn(() => ({ set: updateSet })),
    updateSet,
  };
});

vi.mock("server-only", () => ({}));

vi.mock("cloudflare:workers", () => ({
  waitUntil: vi.fn(),
}));

vi.mock("@/utils/cloudflare-context", () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

vi.mock("@/db", () => ({
  getDB: () => ({ update, query: { apiKeyTable: { findFirst } } }),
}));

vi.mock("@/utils/session-user", () => ({
  getUserFromDB: getUserFromDBMock,
  getUserTeamsWithPermissions: vi.fn(async () => []),
}));

vi.mock("@/utils/trace", () => ({
  withSpan: ({ run }: { run: (span: typeof fakeSpan) => Promise<unknown> }) => run(fakeSpan),
  recordSpanException: vi.fn(),
}));

const {
  getApiKeyPrincipal,
  LAST_USED_UPDATE_INTERVAL_MS,
  resetApiKeyUsageThrottleForTests,
} = await import("@/utils/kv-api-key");
const { getApiKeySnapshotKey } = await import("@/utils/kv-principal-cache");

const USER_ID = "user_key_owner";
const CACHE_ATTRIBUTE = "app.auth.principal.cache";
const OUTCOME_ATTRIBUTE = "app.auth.principal.outcome";
// A scope no catalog can contain, standing in for one a fork removed after the key was issued.
const RETIRED_SCOPE = "removed-by-a-fork:read";

const store = new Map<string, string>();

const kv = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  put: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  delete: vi.fn(),
  list: vi.fn(),
};

function buildSnapshot(
  { scopes, lastUsedAt }: { scopes: string[]; lastUsedAt: number | null },
) {
  return {
    version: CURRENT_API_KEY_CACHE_VERSION,
    keyId: "akey_1",
    userId: USER_ID,
    teamId: null,
    scopes,
    user: {
      id: USER_ID,
      email: "agent@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    },
    teams: [],
    expiresAt: null,
    lastUsedAt,
  };
}

async function seedKey(
  // Recent enough by default that the usage touch short-circuits before it reaches D1.
  { scopes, lastUsedAt = Date.now() }: { scopes: string[]; lastUsedAt?: number | null },
): Promise<string> {
  const { secret, hash } = await generateApiKey({ prefix: API_KEY_PREFIX_LIVE });

  store.set(
    getApiKeySnapshotKey(hash),
    JSON.stringify(buildSnapshot({ scopes, lastUsedAt })),
  );

  return secret;
}

const seedKeyWithScopes = (scopes: string[]) => seedKey({ scopes });

describe("API key principal from a cached snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    resetApiKeyUsageThrottleForTests();
    getCloudflareContextMock.mockResolvedValue({ env: { KV_STORE: kv } });
  });

  test("carries the granted scopes and the key's own audience", async () => {
    const secret = await seedKeyWithScopes([...API_SCOPE_NAMES]);

    const principal = await getApiKeyPrincipal(secret);

    expect(principal?.scopes).toEqual([...API_SCOPE_NAMES]);
    expect(principal?.audience).toEqual({ type: "personal" });
    expect(principal?.user.createdAt).toBeInstanceOf(Date);
  });

  // A snapshot outlives the catalog it was written against, so validation happens here, not at
  // every guard: an unknown name is dropped instead of granting something nothing can check.
  test("drops a stored scope the catalog no longer knows about", async () => {
    const [known] = API_SCOPE_NAMES;
    const secret = await seedKeyWithScopes([known, RETIRED_SCOPE]);

    const principal = await getApiKeyPrincipal(secret);

    expect(principal?.scopes).toEqual([known]);
    expect(principal?.scopes).not.toContain(RETIRED_SCOPE);
  });

  test("a snapshot of only unknown scopes grants nothing rather than everything", async () => {
    const secret = await seedKeyWithScopes([RETIRED_SCOPE]);

    const principal = await getApiKeyPrincipal(secret);

    expect(principal?.scopes).toEqual([]);
  });
});

// The snapshot is never rewritten after a touch, so its `lastUsedAt` stays stale for the whole
// cache generation. Without an isolate-local throttle every cache hit re-reads that stale value
// and schedules another D1 write — these tests pin the bound the module claims.
describe("API key usage stamping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    resetApiKeyUsageThrottleForTests();
    getCloudflareContextMock.mockResolvedValue({ env: { KV_STORE: kv } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("a hot key stamps once per interval, not once per request", async () => {
    const secret = await seedKey({ scopes: [], lastUsedAt: null });

    await getApiKeyPrincipal(secret);
    await getApiKeyPrincipal(secret);
    await getApiKeyPrincipal(secret);

    expect(update).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith({ lastUsedAt: expect.any(Date) });
  });

  test("stamps again once the interval has elapsed", async () => {
    const secret = await seedKey({ scopes: [], lastUsedAt: null });
    const start = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(start);

    await getApiKeyPrincipal(secret);
    nowSpy.mockReturnValue(start + LAST_USED_UPDATE_INTERVAL_MS);
    await getApiKeyPrincipal(secret);

    expect(update).toHaveBeenCalledTimes(2);
  });

  test("skips D1 entirely when the stored stamp is already recent", async () => {
    const secret = await seedKey({ scopes: [], lastUsedAt: Date.now() });

    await getApiKeyPrincipal(secret);

    expect(update).not.toHaveBeenCalled();
  });
});

describe("API key principal resolve span", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    spanAttributes.clear();
    resetApiKeyUsageThrottleForTests();
    getCloudflareContextMock.mockResolvedValue({ env: { KV_STORE: kv } });
  });

  test("tags a cache hit as ok", async () => {
    const secret = await seedKeyWithScopes([]);

    await getApiKeyPrincipal(secret);

    expect(spanAttributes.get("app.auth.principal.credential_kind")).toBe("api_key");
    expect(spanAttributes.get(CACHE_ATTRIBUTE)).toBe("hit");
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("ok");
  });

  test("tags a secret that fails the format check without a cache read", async () => {
    const principal = await getApiKeyPrincipal("not-an-api-key");

    expect(principal).toBeNull();
    expect(kv.get).not.toHaveBeenCalled();
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("malformed");
    expect(spanAttributes.get(CACHE_ATTRIBUTE)).toBeUndefined();
  });

  test.each([
    ["not_found", () => undefined],
    ["revoked", () => keyRow({ revokedAt: new Date() })],
    ["expired", () => keyRow({ expiresAt: new Date(Date.now() - 1) })],
  ])("tags a %s key found on the D1 fallback", async (outcome, row) => {
    const { secret } = await generateApiKey({ prefix: API_KEY_PREFIX_LIVE });
    findFirst.mockResolvedValue(row());

    const principal = await getApiKeyPrincipal(secret);

    expect(principal).toBeNull();
    expect(spanAttributes.get(CACHE_ATTRIBUTE)).toBe("miss");
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe(outcome);
  });

  test("tags a key whose owner is banned", async () => {
    const { secret } = await generateApiKey({ prefix: API_KEY_PREFIX_LIVE });
    findFirst.mockResolvedValue(keyRow());
    const { user } = buildSnapshot({ scopes: [], lastUsedAt: null });
    getUserFromDBMock.mockResolvedValue({ ...user, bannedAt: new Date() });

    const principal = await getApiKeyPrincipal(secret);

    expect(principal).toBeNull();
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("banned");
  });

  test("tags a live key rebuilt from D1 as a miss that resolved", async () => {
    const { secret } = await generateApiKey({ prefix: API_KEY_PREFIX_LIVE });
    findFirst.mockResolvedValue(keyRow());
    getUserFromDBMock.mockResolvedValue(buildSnapshot({ scopes: [], lastUsedAt: null }).user);

    const principal = await getApiKeyPrincipal(secret);

    expect(principal?.userId).toBe(USER_ID);
    expect(spanAttributes.get(CACHE_ATTRIBUTE)).toBe("miss");
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("ok");
  });
});

// Recent enough by default that the usage touch short-circuits before it reaches D1.
function keyRow(overrides: { revokedAt?: Date | null; expiresAt?: Date | null } = {}) {
  return {
    id: "akey_1",
    userId: USER_ID,
    teamId: null,
    scopes: [],
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: new Date(),
    ...overrides,
  };
}
