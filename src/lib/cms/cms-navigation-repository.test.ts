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

// `cms-icons` reads the icon service origin from the Worker env at module load. Nothing else in
// this file touches a binding, so a literal is enough to let the real icon code run under `fetch`.
vi.mock("cloudflare:workers", () => ({
  env: { ICONIFY_API_ORIGIN: "https://api.iconify.design" },
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
  getReadReplicaDB: getDBMock,
}));

vi.mock("@/lib/cms/entry/queries", () => ({
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

const { getCmsNavigationIconBodies, getCmsNavigationTree, saveCmsNavigationTree } = await import(
  "./cms-navigation-repository"
);
const { clearNavigationMemos } = await import("@/lib/cms/navigation-memos");

function navItem({
  slugSegment,
  resolvedPath,
  icon = null,
  iconBody = null,
}: {
  slugSegment: string;
  resolvedPath: string;
  icon?: string | null;
  iconBody?: { markup: string } | null;
}) {
  return {
    id: "nav_intro",
    navigationKey: "docs",
    parentId: null,
    nodeType: CMS_NAVIGATION_NODE_TYPES.PAGE,
    title: "Intro",
    titleTranslations: null,
    icon,
    iconBody,
    iconColor: null,
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
    clearNavigationMemos();
  });

  test("a warm isolate reads the tree once, and the clear forces the next read to run", async () => {
    const findMany = vi.fn().mockResolvedValue([
      navItem({ slugSegment: "intro", resolvedPath: "/docs/intro" }),
    ]);
    getDBMock.mockReturnValue({ query: { cmsNavigationItemTable: { findMany } } });
    getCmsCollectionMock.mockResolvedValue([
      { id: "entry_intro", collection: "docs", slug: "intro", title: "Intro" },
    ]);

    await getCmsNavigationTree({ navigationKey: "docs" });
    await getCmsNavigationTree({ navigationKey: "docs" });
    expect(findMany).toHaveBeenCalledOnce();

    clearNavigationMemos();
    await getCmsNavigationTree({ navigationKey: "docs" });
    expect(findMany).toHaveBeenCalledTimes(2);
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

const LUCIDE_HOUSE = '<path fill="none" stroke="currentColor" stroke-width="2" d="M3 10l9-7l9 7"/>';
const TABLER_HOME = '<path fill="currentColor" d="M5 12l7-7l7 7"/>';
// What `resolveSetIcon` builds around an Iconify body: one complete document, the same shape an
// uploaded file is stored in.
const svgDocument = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`;

interface StoredIcon {
  markup: string;
}

/**
 * Stubs one `saveCmsNavigationTree` call over a single stored `nav_intro` row and records the
 * column values every write receives, so a test can assert what reached D1 rather than that a
 * write happened.
 */
function stubIconSave({
  storedIcon,
  storedIconKey = "lucide:house",
}: { storedIcon?: StoredIcon; storedIconKey?: string } = {}) {
  const existingItem = navItem({
    slugSegment: "intro",
    resolvedPath: "/docs/intro",
    icon: storedIcon ? storedIconKey : null,
    iconBody: storedIcon ?? null,
  });
  const writtenValues: Record<string, unknown>[] = [];
  const db = {
    query: {
      cmsEntryTable: {
        findMany: vi.fn().mockResolvedValue([
          { id: "entry_intro", collection: "docs", slug: "intro" },
        ]),
      },
      cmsNavigationItemTable: {
        findMany: vi.fn().mockResolvedValue([existingItem]),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        writtenValues.push(values);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        writtenValues.push(values);
        return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  };

  getDBMock.mockReturnValue(db);
  getCmsCollectionMock.mockResolvedValue([
    { id: "entry_intro", collection: "docs", slug: "intro", title: "Intro" },
  ]);

  return { writtenValues };
}

function saveIntroWithIcon(
  icon: string | null,
  iconColor: string | null = null,
  iconSvg: string | null = null,
) {
  return saveCmsNavigationTree({
    navigationKey: "docs",
    items: [
      {
        id: "nav_intro",
        parentId: null,
        nodeType: CMS_NAVIGATION_NODE_TYPES.PAGE,
        title: "Intro",
        titleTranslations: null,
        icon,
        iconColor,
        iconSvg,
        entryId: "entry_intro",
        slugSegment: "intro",
        sortOrder: 0,
      },
    ],
  });
}

describe("CMS navigation icons", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    clearNavigationMemos();
  });

  test("a new icon is fetched once per prefix and pinned onto the row", async () => {
    const { writtenValues } = stubIconSave();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      prefix: "lucide",
      width: 24,
      height: 24,
      icons: { house: { body: LUCIDE_HOUSE } },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await saveIntroWithIcon("lucide:house");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.iconify.design/lucide.json?icons=house",
    );
    expect(writtenValues[0]).toMatchObject({
      icon: "lucide:house",
      iconBody: { markup: svgDocument(LUCIDE_HOUSE) },
    });
  });

  test("icons from two sets cost one request each, with every name of a set batched", async () => {
    stubIconSave();
    const fetchMock = vi.fn(async (url: string) => Response.json(
      url.includes("/tabler.json")
        ? { prefix: "tabler", width: 24, height: 24, icons: { home: { body: TABLER_HOME } } }
        : {
            prefix: "lucide",
            width: 24,
            height: 24,
            icons: { house: { body: LUCIDE_HOUSE }, book: { body: LUCIDE_HOUSE } },
          },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await saveCmsNavigationTree({
      navigationKey: "docs",
      items: [
        {
          id: "nav_intro",
          parentId: null,
          nodeType: CMS_NAVIGATION_NODE_TYPES.PAGE,
          title: "Intro",
          titleTranslations: null,
          icon: "lucide:house",
          entryId: "entry_intro",
          slugSegment: "intro",
          sortOrder: 0,
        },
        {
          id: "nav_guides",
          parentId: null,
          nodeType: CMS_NAVIGATION_NODE_TYPES.GROUP,
          title: "Guides",
          titleTranslations: null,
          icon: "lucide:book",
          entryId: null,
          slugSegment: "guides",
          sortOrder: 1,
        },
        {
          id: "nav_home",
          parentId: null,
          nodeType: CMS_NAVIGATION_NODE_TYPES.GROUP,
          title: "Home",
          titleTranslations: null,
          icon: "tabler:home",
          entryId: null,
          slugSegment: null,
          sortOrder: 2,
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual([
      "https://api.iconify.design/lucide.json?icons=house,book",
      "https://api.iconify.design/tabler.json?icons=home",
    ]);
  });

  test("a save that only reorders nodes fetches nothing", async () => {
    const storedIcon = { markup: svgDocument(LUCIDE_HOUSE) };
    const { writtenValues } = stubIconSave({ storedIcon });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await saveIntroWithIcon("lucide:house");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(writtenValues[0]).toMatchObject({ icon: "lucide:house", iconBody: storedIcon });
  });

  test("clearing the icon clears both columns", async () => {
    const { writtenValues } = stubIconSave({ storedIcon: { markup: svgDocument(LUCIDE_HOUSE) } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await saveIntroWithIcon(null);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(writtenValues[0]).toMatchObject({ icon: null, iconBody: null });
  });

  test("an uploaded icon is parsed and pinned without any call to the icon service", async () => {
    const { writtenValues } = stubIconSave();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await saveIntroWithIcon(
      "custom:logo-1a2b3c",
      null,
      '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor"><path d="M0 0h1v1H0z"/></svg>',
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(writtenValues[0]).toMatchObject({
      icon: "custom:logo-1a2b3c",
      iconBody: {
        // Stored exactly as uploaded: the root, its paint, and its viewBox all survive.
        markup: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor">'
          + '<path d="M0 0h1v1H0z"/></svg>',
      },
    });
  });

  test("a refused upload leaves the stored tree untouched", async () => {
    const { writtenValues } = stubIconSave();

    await expect(saveIntroWithIcon(
      "custom:logo-1a2b3c",
      null,
      '<svg viewBox="0 0 32 32"><script>alert(1)</script></svg>',
    )).rejects.toThrow(/not an allowed element/);
    expect(writtenValues).toEqual([]);
  });

  test("a stored upload is re-saved from its own row, so the document is never resent", async () => {
    const storedIcon = { markup: '<svg viewBox="0 0 32 32"><path d="M0 0h1v1H0z"/></svg>' };
    const { writtenValues } = stubIconSave({ storedIcon, storedIconKey: "custom:logo-1a2b3c" });

    await saveIntroWithIcon("custom:logo-1a2b3c");

    expect(writtenValues[0]).toMatchObject({ icon: "custom:logo-1a2b3c", iconBody: storedIcon });
  });

  test("a row stored under an older shape loses its icon instead of failing the page", async () => {
    // This column holds JSON we parsed, not a value the type system checked. Reading `.markup` off
    // a row that predates the shape threw inside the read gate and took down every page the
    // navigation appears on, so the guard drops the row and the tree still renders.
    const { writtenValues } = stubIconSave({
      storedIcon: { body: LUCIDE_HOUSE, width: 24, height: 24 } as unknown as StoredIcon,
    });
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      width: 24,
      height: 24,
      icons: { house: { body: LUCIDE_HOUSE } },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await saveIntroWithIcon("lucide:house");

    // No usable stored document, so the key is fetched again rather than reused or thrown on.
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(writtenValues[0]).toMatchObject({
      icon: "lucide:house",
      iconBody: { markup: svgDocument(LUCIDE_HOUSE) },
    });
  });

  test("the icon color is stored beside the key, and blank means inherit", async () => {
    const { writtenValues } = stubIconSave({ storedIcon: { markup: svgDocument(LUCIDE_HOUSE) } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await saveIntroWithIcon("lucide:house", "#3b82f6");

    // Colour is plain data, so it never costs a lookup at the icon service.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writtenValues[0]).toMatchObject({ icon: "lucide:house", iconColor: "#3b82f6" });
  });

  test("a whitespace-only color is stored as inherit, not as a blank token", async () => {
    const { writtenValues } = stubIconSave({ storedIcon: { markup: svgDocument(LUCIDE_HOUSE) } });
    vi.stubGlobal("fetch", vi.fn());

    await saveIntroWithIcon("lucide:house", "   ");

    expect(writtenValues[0]).toMatchObject({ iconColor: null });
  });

  test("clearing the icon leaves the color independent of it", async () => {
    const { writtenValues } = stubIconSave({ storedIcon: { markup: svgDocument(LUCIDE_HOUSE) } });
    vi.stubGlobal("fetch", vi.fn());

    await saveIntroWithIcon(null, "#ef4444");

    // The colour still applies: the sidebar paints the node-type fallback with it.
    expect(writtenValues[0]).toMatchObject({ icon: null, iconBody: null, iconColor: "#ef4444" });
  });

  test("an unreachable icon service writes nothing at all", async () => {
    const { writtenValues } = stubIconSave();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(saveIntroWithIcon("lucide:house")).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(writtenValues).toHaveLength(0);
    expect(revalidateCacheTagMock).not.toHaveBeenCalled();
  });

  test("an icon the set no longer holds refuses the whole save", async () => {
    const { writtenValues } = stubIconSave();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      prefix: "lucide",
      icons: {},
      not_found: ["house"],
    })));

    await expect(saveIntroWithIcon("lucide:house")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(writtenValues).toHaveLength(0);
  });
});

describe("navigation icon bodies", () => {
  afterEach(() => {
    vi.clearAllMocks();
    clearNavigationMemos();
  });

  function stubStoredTree(items: ReturnType<typeof navItem>[]): void {
    getDBMock.mockReturnValue({
      query: {
        cmsNavigationItemTable: { findMany: vi.fn().mockResolvedValue(items) },
      },
    });
    getCmsCollectionMock.mockResolvedValue([
      { id: "entry_intro", collection: "docs", slug: "intro", title: "Intro" },
    ]);
  }

  test("two rows pinning one icon share a single body, and no node carries markup", async () => {
    const iconBody = { markup: svgDocument(LUCIDE_HOUSE) };
    stubStoredTree([
      { ...navItem({ slugSegment: "a", resolvedPath: "/docs/a", icon: "lucide:house", iconBody }), id: "nav_a" },
      { ...navItem({ slugSegment: "b", resolvedPath: "/docs/b", icon: "lucide:house", iconBody }), id: "nav_b" },
    ]);

    const [iconBodyByKey, nodes] = await Promise.all([
      getCmsNavigationIconBodies({ navigationKey: "docs" }),
      getCmsNavigationTree({ navigationKey: "docs" }),
    ]);

    expect(Object.keys(iconBodyByKey)).toEqual(["lucide:house"]);
    expect(nodes.every((node) => !("iconBody" in node))).toBe(true);
  });

  test("a stored body the allowlist now refuses is dropped on the way out", async () => {
    stubStoredTree([
      navItem({
        slugSegment: "intro",
        resolvedPath: "/docs/intro",
        icon: "lucide:house",
        iconBody: { markup: svgDocument("<script>steal()</script>") },
      }),
    ]);

    await expect(getCmsNavigationIconBodies({ navigationKey: "docs" })).resolves.toEqual({});
  });
});
