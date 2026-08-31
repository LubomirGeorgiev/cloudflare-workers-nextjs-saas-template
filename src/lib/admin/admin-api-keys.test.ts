// Two contracts live here. `createAdminApiKey` is the only door that hands `issueApiKey` the
// internal catalog, and it must refuse a public scope before it delegates. And the demotion
// revocation must stay inside D1's 100-bound-parameter ceiling however many keys a user holds.

import { beforeEach, describe, expect, test, vi } from "vitest";

const { dbMock, inArrayCalls, issueApiKeyMock, updateWhereMock } = vi.hoisted(() => ({
  dbMock: {
    query: { apiKeyTable: { findMany: vi.fn() } },
    update: vi.fn(),
  },
  inArrayCalls: [] as string[][],
  issueApiKeyMock: vi.fn(),
  updateWhereMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/db", () => ({ getDB: () => dbMock }));

// The chunk boundaries are the thing under test, and they are only visible in the id list handed
// to `inArray`; reading them back out of a built SQL fragment would test drizzle instead.
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  inArray: (_column: unknown, values: string[]) => {
    inArrayCalls.push(values);
    return { values };
  },
}));

vi.mock("@/lib/api-keys/api-keys", () => ({
  apiKeyExpiryFromDays: (days?: number | null) => (days ? new Date(days) : null),
  issueApiKey: issueApiKeyMock,
  listOwnInternalApiKeys: vi.fn(),
  revokeApiKey: vi.fn(),
}));

vi.mock("@/utils/auth", () => ({ requireAdmin: async () => undefined }));

const { API_KEY_PREFIX_ADMIN } = await import("@/constants");
const { ADMIN_SCOPE_NAMES } = await import("@/lib/api/admin-scopes");
const { API_SCOPE_NAMES } = await import("@/lib/api/scopes");
const { createAdminApiKey, revokeInternalApiKeysForUser } = await import("@/lib/admin/admin-api-keys");

// Derived from the catalogs, never spelled out: a fork renames scopes and these tests still hold.
const INTERNAL_SCOPE = ADMIN_SCOPE_NAMES[0];
const PUBLIC_SCOPE = API_SCOPE_NAMES[0];
// The parameter ceiling the chunking exists for; a chunk must always stay under it.
const D1_BOUND_PARAMETER_LIMIT = 100;

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

beforeEach(() => {
  vi.clearAllMocks();
  inArrayCalls.length = 0;
  updateWhereMock.mockResolvedValue(undefined);
  dbMock.update.mockImplementation(() => ({ set: () => ({ where: updateWhereMock }) }));
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
  test("chunks well under D1's bound-parameter ceiling and covers every key", async () => {
    const internalIds = seedKeys({ internal: 137, publicKeys: 3 });

    await expect(revokeInternalApiKeysForUser("usr_1")).resolves.toBe(internalIds.length);

    expect(inArrayCalls.length).toBeGreaterThan(1);
    for (const chunk of inArrayCalls) {
      expect(chunk.length).toBeLessThan(D1_BOUND_PARAMETER_LIMIT);
    }
    expect(inArrayCalls.flat()).toEqual(internalIds);
  });

  test("revokes one statement's worth without chunking when the user holds few keys", async () => {
    const internalIds = seedKeys({ internal: 2, publicKeys: 1 });

    await revokeInternalApiKeysForUser("usr_1");

    expect(inArrayCalls).toEqual([internalIds]);
  });

  test("touches nothing when the user holds no internal key", async () => {
    seedKeys({ internal: 0, publicKeys: 4 });

    await expect(revokeInternalApiKeysForUser("usr_1")).resolves.toBe(0);

    expect(dbMock.update).not.toHaveBeenCalled();
  });

  test("attempts every chunk after one fails, then reports the failure", async () => {
    const internalIds = seedKeys({ internal: 137, publicKeys: 0 });
    updateWhereMock.mockRejectedValueOnce(new Error("D1 unavailable"));

    await expect(revokeInternalApiKeysForUser("usr_1")).rejects.toThrow();

    // A chunk left live is a credential nobody can reach, so the failure must not stop the sweep.
    expect(inArrayCalls.flat()).toEqual(internalIds);
  });
});
