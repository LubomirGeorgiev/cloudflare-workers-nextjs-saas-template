import { beforeEach, describe, expect, test, vi } from "vitest";

const { getDBMock } = vi.hoisted(() => ({ getDBMock: vi.fn() }));

vi.mock("server-only", () => ({}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
  getReadReplicaDB: getDBMock,
}));

const { getCmsNavigationEntryPaths } = await import("./cms-navigation-entry-paths");

// The real join runs against D1 in `tests/integration/cms-navigation-entry-paths.test.ts`.
function mockDb(navigationRows: { resolvedPath: string | null }[]) {
  const where = vi.fn(async () => navigationRows);
  const query = { from: () => query, innerJoin: () => query, where };

  getDBMock.mockReturnValue({ select: () => query });

  return { where };
}

describe("getCmsNavigationEntryPaths", () => {
  beforeEach(() => {
    getDBMock.mockReset();
  });

  test("resolves the public path of a docs entry from its navigation item", async () => {
    const { where } = mockDb([{ resolvedPath: "/docs/guides/getting-started" }]);

    const paths = await getCmsNavigationEntryPaths({
      entries: [{ collection: "docs", slug: "getting-started" }],
    });

    expect(paths).toEqual(["/docs/guides/getting-started"]);
    expect(where).toHaveBeenCalledTimes(1);
  });

  test("reads nothing for a collection whose URL comes from previewUrl", async () => {
    mockDb([]);

    const paths = await getCmsNavigationEntryPaths({
      entries: [{ collection: "blog", slug: "launch" }],
    });

    expect(paths).toEqual([]);
    expect(getDBMock).not.toHaveBeenCalled();
  });

  test("skips a navigation item that has no resolved path", async () => {
    mockDb([{ resolvedPath: null }]);

    await expect(
      getCmsNavigationEntryPaths({ entries: [{ collection: "docs", slug: "orphan" }] }),
    ).resolves.toEqual([]);
  });

  test("never throws when the lookup fails", async () => {
    getDBMock.mockImplementation(() => {
      throw new Error("D1 unavailable");
    });

    await expect(
      getCmsNavigationEntryPaths({ entries: [{ collection: "docs", slug: "getting-started" }] }),
    ).resolves.toEqual([]);
  });
});
