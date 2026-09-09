// Two contracts live here. `createAdminApiKey` is the only door that hands `issueApiKey` the
// internal catalog, and it must refuse a public scope before it delegates. And the demotion path
// must hand `deleteApiKeysByIds` the internal keys and only those; the chunking and the failure
// policy behind that call belong to the helper, and are covered by its own test.

import { beforeEach, describe, expect, test, vi } from "vitest";

const { dbMock, deleteApiKeysByIdsMock, issueApiKeyMock } = vi.hoisted(() => ({
  dbMock: { query: { apiKeyTable: { findMany: vi.fn() } } },
  deleteApiKeysByIdsMock: vi.fn(),
  issueApiKeyMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/db", () => ({ getDB: () => dbMock }));

vi.mock("@/lib/api-keys/api-keys", () => ({
  apiKeyExpiryFromDays: (days?: number | null) => (days ? new Date(days) : null),
  issueApiKey: issueApiKeyMock,
  listOwnInternalApiKeys: vi.fn(),
  revokeApiKey: vi.fn(),
}));

// Mocked rather than loaded: its real graph reaches `cloudflare:workers` through the KV cache,
// which only resolves in the Workers pool.
vi.mock("@/lib/api-keys/delete-api-keys", () => ({ deleteApiKeysByIds: deleteApiKeysByIdsMock }));

vi.mock("@/utils/auth", () => ({ requireAdmin: async () => undefined }));

const { API_KEY_PREFIX_ADMIN } = await import("@/constants");
const { ADMIN_SCOPE_NAMES } = await import("@/lib/api/admin-scopes");
const { API_SCOPE_NAMES } = await import("@/lib/api/scopes");
const { createAdminApiKey, revokeInternalApiKeysForUser } = await import("@/lib/admin/admin-api-keys");

// Derived from the catalogs, never spelled out: a fork renames scopes and these tests still hold.
const INTERNAL_SCOPE = ADMIN_SCOPE_NAMES[0];
const PUBLIC_SCOPE = API_SCOPE_NAMES[0];

function seedKeys({ internal, publicKeys }: { internal: number; publicKeys: number }): string[] {
  const internalIds = Array.from({ length: internal }, (_, index) => `akey_internal_${index}`);

  dbMock.query.apiKeyTable.findMany.mockResolvedValue([
    ...internalIds.map((id) => ({ id, scopes: [INTERNAL_SCOPE] })),
    ...Array.from({ length: publicKeys }, (_, index) => ({
      id: `akey_public_${index}`,
      scopes: [PUBLIC_SCOPE],
    })),
  ]);

  return internalIds;
}

function deletedIds(): string[] {
  return deleteApiKeysByIdsMock.mock.calls[0]?.[0]?.ids ?? [];
}

function selectWhere(): Record<string, unknown> {
  return dbMock.query.apiKeyTable.findMany.mock.calls[0]?.[0]?.where ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteApiKeysByIdsMock.mockImplementation(async ({ ids }: { ids: string[] }) => ids.length);
});

describe("createAdminApiKey", () => {
  test("mints with the internal catalog and the internal prefix", async () => {
    issueApiKeyMock.mockResolvedValue({ secret: "s", key: {} });

    await createAdminApiKey({ name: "Ops agent", scopes: [INTERNAL_SCOPE], expiresInDays: 30 });

    const params = issueApiKeyMock.mock.calls[0]?.[0];

    expect(params.teamId).toBeNull();
    expect(params.keyPrefix).toBe(API_KEY_PREFIX_ADMIN);
    expect(params.isAllowedScope(INTERNAL_SCOPE)).toBe(true);
    expect(params.isAllowedScope(PUBLIC_SCOPE)).toBe(false);
    expect(params.expiresAt).toBeInstanceOf(Date);
  });

  test("refuses a public scope before it delegates", async () => {
    await expect(
      createAdminApiKey({ name: "Ops agent", scopes: [PUBLIC_SCOPE] }),
    ).rejects.toThrow();

    expect(issueApiKeyMock).not.toHaveBeenCalled();
  });
});

describe("revokeInternalApiKeysForUser", () => {
  test("hands every internal key of the user to the shared delete helper", async () => {
    const internalIds = seedKeys({ internal: 137, publicKeys: 3 });

    await expect(revokeInternalApiKeysForUser("usr_1")).resolves.toBe(internalIds.length);

    expect(deletedIds()).toEqual(internalIds);
  });

  // A public key on the same account is untouched: a demotion takes the internal credentials and
  // nothing else.
  test("leaves the user's public keys out of the delete", async () => {
    seedKeys({ internal: 1, publicKeys: 4 });

    await revokeInternalApiKeysForUser("usr_1");

    expect(deletedIds()).toEqual(["akey_internal_0"]);
  });

  test("touches nothing when the user holds no internal key", async () => {
    seedKeys({ internal: 0, publicKeys: 4 });

    await expect(revokeInternalApiKeysForUser("usr_1")).resolves.toBe(0);

    expect(deletedIds()).toEqual([]);
  });

  // One rule: every internal row goes, so the select carries no liveness filter and the helper is
  // handed no predicate that could spare an expired key or a revoked leftover.
  test("selects every internal row, expired and revoked leftovers included", async () => {
    seedKeys({ internal: 2, publicKeys: 0 });

    await revokeInternalApiKeysForUser("usr_1");

    expect(selectWhere()).toEqual({ userId: "usr_1" });
    expect(deleteApiKeysByIdsMock.mock.calls[0]?.[0]?.onlyDeadAt).toBeUndefined();
  });
});
