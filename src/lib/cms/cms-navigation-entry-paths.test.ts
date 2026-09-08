import { beforeEach, describe, expect, test, vi } from "vitest";

const { getDBMock } = vi.hoisted(() => ({ getDBMock: vi.fn() }));

vi.mock("server-only", () => ({}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
  getReadReplicaDB: getDBMock,
}));

const { getCmsNavigationEntryPaths } = await import("./cms-navigation-entry-paths");

function mockDb({
  entryRows,
  navigationRows,
}: {
  entryRows: { id: string }[];
  navigationRows: { resolvedPath: string | null }[];
}) {
  const findEntries = vi.fn(async () => entryRows);
  const findNavigationItems = vi.fn(async () => navigationRows);

  getDBMock.mockReturnValue({
    query: {
      cmsEntryTable: { findMany: findEntries },
      cmsNavigationItemTable: { findMany: findNavigationItems },
    },
  });

  return { findEntries, findNavigationItems };
}

describe("getCmsNavigationEntryPaths", () => {
  beforeEach(() => {
    getDBMock.mockReset();
  });

  test("resolves the public path of a docs entry from its navigation item", async () => {
    const { findNavigationItems } = mockDb({
      entryRows: [{ id: "cms_ent_1" }, { id: "cms_ent_2" }],
      navigationRows: [{ resolvedPath: "/docs/guides/getting-started" }],
    });

    const paths = await getCmsNavigationEntryPaths({
      entries: [{ collection: "docs", slug: "getting-started" }],
    });

    expect(paths).toEqual(["/docs/guides/getting-started"]);
    // Every locale row of the slug, so an edited translation resolves the anchor's path too.
    expect(findNavigationItems).toHaveBeenCalledWith({
      where: { navigationKey: "docs", entryId: { in: ["cms_ent_1", "cms_ent_2"] } },
      columns: { resolvedPath: true },
    });
  });

  test("reads nothing for a collection whose URL comes from previewUrl", async () => {
    mockDb({ entryRows: [{ id: "cms_ent_1" }], navigationRows: [] });

    const paths = await getCmsNavigationEntryPaths({
      entries: [{ collection: "blog", slug: "launch" }],
    });

    expect(paths).toEqual([]);
    expect(getDBMock).not.toHaveBeenCalled();
  });

  test("skips a navigation item that has no resolved path", async () => {
    mockDb({ entryRows: [{ id: "cms_ent_1" }], navigationRows: [{ resolvedPath: null }] });

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
