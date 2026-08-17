import { afterEach, describe, expect, test, vi } from "vitest";

import { INDEXED_DOCS_ROUTES } from "@/constants/docs-routes";
import { DEFAULT_LOCALE, ENABLED_LOCALES } from "@/i18n/config";
import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation";

const {
  getCmsCollectionMock,
  getDBMock,
  invalidateCmsSearchCacheMock,
  purgeMarkdownPageCacheMock,
  revalidateCacheTagMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  getCmsCollectionMock: vi.fn(),
  getDBMock: vi.fn(),
  invalidateCmsSearchCacheMock: vi.fn(),
  purgeMarkdownPageCacheMock: vi.fn(async () => undefined),
  revalidateCacheTagMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

vi.mock("@/lib/cms/entry", () => ({
  getCmsCollection: getCmsCollectionMock,
}));

vi.mock("@/lib/cms/cms-search", () => ({
  invalidateCmsSearchCache: invalidateCmsSearchCacheMock,
  isCollectionSearchEnabled: (collectionSlug: string) => collectionSlug === "docs",
}));

// The KV sweep itself needs a Worker binding; its locale matrix is asserted in
// `cms-entry-revalidation.test.ts`, so here we only prove this call site reaches it.
vi.mock("@/lib/markdown-pages/purge-page-cache", () => ({
  purgeMarkdownPageCache: purgeMarkdownPageCacheMock,
}));

vi.mock("@/utils/cache", () => ({
  CACHE_TAGS: {
    SITEMAP: "sitemap",
    cmsNavigation: (navigationKey: string) => `cms-navigation-${navigationKey}`,
    cmsRedirect: (navigationKey: string) => `cms-redirect-${navigationKey}`,
  },
  revalidateCacheTag: revalidateCacheTagMock,
  setCacheScope: vi.fn(),
}));

const { saveCmsNavigationTree } = await import("./cms-navigation-repository");

function navItem({ slugSegment, resolvedPath }: { slugSegment: string; resolvedPath: string }) {
  return {
    id: "nav_intro",
    navigationKey: "docs",
    parentId: null,
    nodeType: CMS_NAVIGATION_NODE_TYPES.PAGE,
    title: "Intro",
    titleTranslations: null,
    entryId: "entry_intro",
    slugSegment,
    resolvedPath,
    sortOrder: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

/** Stubs the reads and writes of one `saveCmsNavigationTree` call that renames the `nav_intro` node. */
function stubIntroRename(): void {
  const existingItem = navItem({
    slugSegment: "old-intro",
    resolvedPath: "/docs/old-intro",
  });
  const savedItem = navItem({
    slugSegment: "new-intro",
    resolvedPath: "/docs/new-intro",
  });
  const db = {
    query: {
      cmsEntryTable: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "entry_intro",
            collection: "docs",
            slug: "intro",
          },
        ]),
      },
      cmsNavigationItemTable: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([existingItem])
          .mockResolvedValueOnce([savedItem]),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  };

  getDBMock.mockReturnValue(db);
  getCmsCollectionMock.mockResolvedValue([
    {
      id: "entry_intro",
      collection: "docs",
      slug: "intro",
      title: "Intro",
    },
  ]);
}

async function saveRenamedIntro(): Promise<void> {
  await saveCmsNavigationTree({
    navigationKey: "docs",
    items: [
      {
        id: "nav_intro",
        parentId: null,
        nodeType: CMS_NAVIGATION_NODE_TYPES.PAGE,
        title: "Intro",
        titleTranslations: null,
        entryId: "entry_intro",
        slugSegment: "new-intro",
        sortOrder: 0,
      },
    ],
  });
}

describe("CMS navigation repository", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("saveCmsNavigationTree revalidates old and new public docs paths for every served locale", async () => {
    stubIntroRename();

    await saveRenamedIntro();

    for (const path of ["/docs/old-intro", "/docs/new-intro"]) {
      for (const locale of ENABLED_LOCALES) {
        expect(revalidatePathMock).toHaveBeenCalledWith(
          locale === DEFAULT_LOCALE ? path : `/${locale}${path}`
        );
      }
    }
  });

  test("saveCmsNavigationTree purges the page Markdown cache of the docs app routes", async () => {
    stubIntroRename();

    await saveRenamedIntro();

    // Those pages render the sidebar from this tree, and `revalidatePath` cannot reach their KV copy.
    expect(purgeMarkdownPageCacheMock).toHaveBeenCalledTimes(1);
    expect(purgeMarkdownPageCacheMock).toHaveBeenCalledWith({
      pathnames: INDEXED_DOCS_ROUTES.map(({ pathname }) => pathname),
    });
  });
});
