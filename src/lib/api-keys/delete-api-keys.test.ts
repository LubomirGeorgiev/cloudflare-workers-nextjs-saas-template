// The one delete path an owner revoke, a ban, a demotion, and the retention sweep all share. It
// stays inside D1's bound-parameter ceiling, it attempts every chunk after one fails, and it counts
// only the rows that actually left D1.

import { beforeEach, expect, test, vi } from "vitest";

const {
  dbMock,
  deleteApiKeyCacheMock,
  deleteReturningMock,
  deleteWhere,
  deleteWhereParts,
} = vi.hoisted(() => ({
  dbMock: { delete: vi.fn(), update: vi.fn() },
  deleteApiKeyCacheMock: vi.fn(),
  deleteReturningMock: vi.fn(),
  deleteWhere: [] as string[][],
  deleteWhereParts: [] as unknown[][],
}));

vi.mock("server-only", () => ({}));

vi.mock("@/db", () => ({ getDB: () => dbMock }));

// The chunk boundaries are the thing under test, and they are only visible in the id list handed
// to `inArray`; reading them back out of a built SQL fragment would test drizzle instead.
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  inArray: (_column: unknown, values: string[]) => ({ kind: "inArray", values }),
  and: (...parts: unknown[]) => ({ kind: "and", parts }),
}));

vi.mock("@/utils/kv-api-key", () => ({ deleteApiKeyCache: deleteApiKeyCacheMock }));

const { deleteApiKeysByIds } = await import("@/lib/api-keys/delete-api-keys");

// The ceiling the chunking exists for; a chunk must always stay under it.
const D1_BOUND_PARAMETER_LIMIT = 100;

interface AndFragment {
  parts: { kind?: string; values?: string[] }[];
}

/** The id list of the `inArray` inside a `where` fragment, which is what a chunk boundary is. */
function idsOf(fragment: unknown): string[] {
  return (fragment as AndFragment).parts.find((part) => part.kind === "inArray")?.values ?? [];
}

/** Every part of a `where` fragment that is not the id list. The real `and` drops the undefined. */
function extraPartsOf(fragment: unknown): unknown[] {
  return (fragment as AndFragment).parts
    .filter((part) => part !== undefined && part.kind !== "inArray");
}

function ids(count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => `akey_${index}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteWhere.length = 0;
  deleteWhereParts.length = 0;
  deleteApiKeyCacheMock.mockResolvedValue(undefined);

  // Each deleted row hands back the hash whose KV snapshot the helper then drops.
  deleteReturningMock.mockImplementation(async () =>
    (deleteWhere.at(-1) ?? []).map((id) => ({ keyHash: `hash_${id}` })));

  dbMock.delete.mockImplementation(() => ({
    where: (fragment: unknown) => {
      deleteWhere.push(idsOf(fragment));
      deleteWhereParts.push(extraPartsOf(fragment));
      return { returning: deleteReturningMock };
    },
  }));

  // Every chunk is stamped revoked before it is deleted; the stamp itself is proven end to end in
  // `tests/integration/api-key-service.test.ts`.
  dbMock.update.mockImplementation(() => ({ set: () => ({ where: async () => undefined }) }));
});

test("chunks well under D1's bound-parameter ceiling and covers every key", async () => {
  const all = ids(137);

  await expect(deleteApiKeysByIds({ ids: all })).resolves.toBe(all.length);

  expect(deleteWhere.length).toBeGreaterThan(1);
  for (const batch of deleteWhere) {
    expect(batch.length).toBeLessThan(D1_BOUND_PARAMETER_LIMIT);
  }
  expect(deleteWhere.flat()).toEqual(all);
});

test("deletes one statement's worth without chunking when there are few keys", async () => {
  const all = ids(2);

  await deleteApiKeysByIds({ ids: all });

  expect(deleteWhere).toEqual([all]);
});

// The retention sweep selects dead rows, then deletes by id. Without the re-check a key revived
// between the two statements would be deleted anyway, so the DELETE has to carry the rule too.
test("re-states the liveness rule in the delete when a dead-at instant is given", async () => {
  await deleteApiKeysByIds({ ids: ids(2), onlyDeadAt: new Date("2026-01-01T00:00:00Z") });

  expect(deleteWhereParts).toEqual([[expect.anything()]]);
});

test("deletes by id alone when no dead-at instant is given", async () => {
  await deleteApiKeysByIds({ ids: ids(2) });

  expect(deleteWhereParts).toEqual([[]]);
});

test("touches nothing for an empty list", async () => {
  await expect(deleteApiKeysByIds({ ids: [] })).resolves.toBe(0);

  expect(dbMock.delete).not.toHaveBeenCalled();
});

// The row is what names the snapshot, so dropping one without the other would strand it in KV
// until its TTL — the window a revocation exists to close.
test("drops the KV snapshot of every key it deletes", async () => {
  const all = ids(5);

  await deleteApiKeysByIds({ ids: all });

  expect(deleteApiKeyCacheMock.mock.calls.map(([arg]) => arg.keyHash))
    .toEqual(all.map((id) => `hash_${id}`));
});

test("attempts every chunk after one fails, then reports the failure", async () => {
  const all = ids(137);
  deleteReturningMock.mockRejectedValueOnce(new Error("D1 unavailable"));

  await expect(deleteApiKeysByIds({ ids: all })).rejects.toThrow();

  // A chunk left live is a credential nobody can reach, so the failure must not stop the rest.
  expect(deleteWhere.flat()).toEqual(all);
});

test("counts only the rows that actually left D1", async () => {
  const all = ids(60);
  deleteReturningMock.mockRejectedValueOnce(new Error("D1 unavailable"));

  await deleteApiKeysByIds({ ids: all }).catch(() => undefined);

  // The failed chunk never reaches the cache purge either; only the survivors do.
  expect(deleteApiKeyCacheMock).toHaveBeenCalledTimes(10);
});
