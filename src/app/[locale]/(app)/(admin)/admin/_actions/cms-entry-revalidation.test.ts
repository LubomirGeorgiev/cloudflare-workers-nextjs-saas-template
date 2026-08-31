import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { cmsConfig } from "@/../cms.config";
import { MARKDOWN_PAGE_CACHE_PREFIX } from "@/constants/kv-prefixes";
import { ENABLED_LOCALES } from "@/i18n/config";
import { localizedPagePathname } from "@/lib/markdown-pages/page-paths";

// The Vite `define` that injects the build id is not applied under the unit test config.
const MARKDOWN_BUILD_ID = "test-build-id";

const { kvDeleteMock, kvStore, revalidatePathMock } = vi.hoisted(() => ({
  kvDeleteMock: vi.fn(),
  kvStore: new Set<string>(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("cloudflare:workers", () => ({
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

const { revalidateCmsEntryPaths } = await import("./cms-entry-revalidation");

const BLOG_ENTRY_PATH = cmsConfig.collections.blog.previewUrl("launch-notes");
/** `/blog` for the template: the listing root every affected page sits under. */
const BLOG_LISTING_PATH = BLOG_ENTRY_PATH.slice(0, BLOG_ENTRY_PATH.lastIndexOf("/"));

function pageCacheKey(pathname: string): string {
  return `${MARKDOWN_PAGE_CACHE_PREFIX}${MARKDOWN_BUILD_ID}:${pathname}`;
}

describe("revalidateCmsEntryPaths", () => {
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

    await revalidateCmsEntryPaths({
      collection: "blog",
      entryId: "entry_launch_notes",
      slugs: ["launch-notes"],
    });

    const deleted = kvDeleteMock.mock.calls.map(([key]) => key as string);
    expect(deleted.toSorted()).toEqual(affectedKeys.toSorted());
    expect(deleted).not.toContain(unrelatedKey);
  });

  test("a failing delete does not fail the publish that already committed", async () => {
    kvStore.add(pageCacheKey(BLOG_LISTING_PATH));
    kvDeleteMock.mockRejectedValue(new Error("KV unavailable"));

    await expect(
      revalidateCmsEntryPaths({
        collection: "blog",
        entryId: "entry_launch_notes",
        slugs: ["launch-notes"],
      }),
    ).resolves.toBeUndefined();
  });
});
