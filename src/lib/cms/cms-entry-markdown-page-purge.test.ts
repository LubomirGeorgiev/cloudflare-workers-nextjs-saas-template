import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { cmsConfig } from "@/../cms.config";
import { MARKDOWN_PAGE_CACHE_PREFIX } from "@/constants/kv-prefixes";
import { ENABLED_LOCALES } from "@/i18n/config";
import { BLOG_COLLECTION_SLUG } from "@/lib/blog-routing";
import { localizedPagePathname } from "@/lib/markdown-pages/page-paths";

// The Vite `define` that injects the build id is not applied under the unit test config.
const MARKDOWN_BUILD_ID = "test-build-id";

const { kvDeleteMock, kvStore } = vi.hoisted(() => ({
  kvDeleteMock: vi.fn(),
  kvStore: new Set<string>(),
}));

vi.mock("server-only", () => ({}));

// Both lookups read D1; the blog collection resolves its path from `previewUrl` alone.
vi.mock("@/lib/cms/cms-navigation-entry-paths", () => ({
  getCmsNavigationPagePaths: async () => [],
}));

vi.mock("@/lib/cms/blog-listing-post-counts", () => ({
  getBlogListingPostCounts: async () => [],
}));

// Keeps the untraced `tracing` stub, which the purge's span needs.
vi.mock("cloudflare:workers", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  env: {
    KV_STORE: {
      delete: kvDeleteMock,
      list: async ({ prefix }: { prefix: string }) => ({
        keys: Array.from(kvStore)
          .filter((key) => key.startsWith(prefix))
          .map((name) => ({ name })),
        list_complete: true,
      }),
    },
  },
}));

const { purgeCmsPages } = await import("./cms-entry-page-purge");
const { CMS_INVALIDATION_SCOPES } = await import("./cms-invalidation-scopes");

const BLOG_ENTRIES = [{ collection: BLOG_COLLECTION_SLUG, slug: "launch-notes" }];
const NO_ENTRY_ROWS = async () => [];

const BLOG_ENTRY_PATH = cmsConfig.collections[BLOG_COLLECTION_SLUG].previewUrl("launch-notes");
/** `/blog` for the template: the listing root every affected page sits under. */
const BLOG_LISTING_PATH = BLOG_ENTRY_PATH.slice(0, BLOG_ENTRY_PATH.lastIndexOf("/"));

function pageCacheKey(pathname: string): string {
  return `${MARKDOWN_PAGE_CACHE_PREFIX}${MARKDOWN_BUILD_ID}:${pathname}`;
}

describe("purgeCmsPages, the `.md` half", () => {
  beforeEach(() => {
    vi.stubGlobal("__MARKDOWN_BUILD_ID__", MARKDOWN_BUILD_ID);
    kvStore.clear();
    kvDeleteMock.mockReset();
    kvDeleteMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test("deletes the page Markdown cache of every affected page, in every served locale", async () => {
    const affectedKeys = ENABLED_LOCALES.flatMap((locale) => {
      const listing = localizedPagePathname({ locale, pathname: BLOG_LISTING_PATH });

      return [
        pageCacheKey(listing),
        pageCacheKey(`${listing}/2`),
        pageCacheKey(`${listing}/tags/react`),
        pageCacheKey(`${listing}/authors/ada`),
        pageCacheKey(localizedPagePathname({ locale, pathname: BLOG_ENTRY_PATH })),
      ];
    });
    // A page the publish cannot affect: it must survive the sweep.
    const unrelatedKey = pageCacheKey("/terms");
    for (const key of [...affectedKeys, unrelatedKey]) {
      kvStore.add(key);
    }

    await purgeCmsPages({ entries: BLOG_ENTRIES, navigationKeys: [], readAllEntryRefs: NO_ENTRY_ROWS, scopes: [] });

    const deleted = kvDeleteMock.mock.calls.map(([key]) => key as string);
    expect(deleted.toSorted()).toEqual(affectedKeys.toSorted());
    expect(deleted).not.toContain(unrelatedKey);
  });

  test("a failing delete does not fail the publish that already committed", async () => {
    kvStore.add(pageCacheKey(BLOG_LISTING_PATH));
    kvDeleteMock.mockRejectedValue(new Error("KV unavailable"));

    await expect(
      purgeCmsPages({ entries: BLOG_ENTRIES, navigationKeys: [], readAllEntryRefs: NO_ENTRY_ROWS, scopes: [] }),
    ).resolves.toBeDefined();
  });

  // The header sits outside `<main>`, which is all a twin converts, so a header flip keeps them.
  test("a site header purge deletes no `.md` twin", async () => {
    kvStore.add(pageCacheKey("/terms"));

    await purgeCmsPages({
      entries: [],
      navigationKeys: [],
      readAllEntryRefs: NO_ENTRY_ROWS,
      scopes: [CMS_INVALIDATION_SCOPES.SITE_HEADER],
    });

    expect(kvDeleteMock).not.toHaveBeenCalled();
  });

  test("a full CMS clear deletes every `.md` twin", async () => {
    const keys = [pageCacheKey("/terms"), pageCacheKey(BLOG_LISTING_PATH)];
    for (const key of keys) {
      kvStore.add(key);
    }

    await purgeCmsPages({
      entries: [],
      navigationKeys: [],
      readAllEntryRefs: NO_ENTRY_ROWS,
      scopes: [CMS_INVALIDATION_SCOPES.ALL_CMS],
    });

    expect(kvDeleteMock.mock.calls.map(([key]) => key as string).toSorted()).toEqual(keys.toSorted());
  });
});
