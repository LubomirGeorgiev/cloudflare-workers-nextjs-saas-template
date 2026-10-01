import { afterEach, describe, expect, test, vi } from "vitest";

import { cmsConfig } from "@/../cms.config";
import { ENABLED_LOCALES } from "@/i18n/config";
import { BLOG_COLLECTION_SLUG } from "@/lib/blog-routing";
import { localizedPagePathname } from "@/lib/markdown-pages/page-paths";

const { purgeMarkdownPageCacheMock, revalidatePathMock } = vi.hoisted(() => ({
  purgeMarkdownPageCacheMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/markdown-pages/purge-page-cache", () => ({
  purgeMarkdownPageCache: purgeMarkdownPageCacheMock,
}));

const { revalidateCmsEntryPaths } = await import("./cms-entry-revalidation");

const BLOG_ENTRY_PATH = cmsConfig.collections[BLOG_COLLECTION_SLUG].previewUrl("launch-notes");

describe("revalidateCmsEntryPaths", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("revalidates the entry page in every served locale", () => {
    revalidateCmsEntryPaths({
      collection: BLOG_COLLECTION_SLUG,
      entryId: "entry_launch_notes",
      slugs: ["launch-notes"],
    });

    for (const locale of ENABLED_LOCALES) {
      expect(revalidatePathMock).toHaveBeenCalledWith(
        localizedPagePathname({ locale, pathname: BLOG_ENTRY_PATH }),
      );
    }
  });

  // It runs after the write returned, so a sweep here would delete the twins the warm stored.
  test("never purges the page Markdown cache", () => {
    revalidateCmsEntryPaths({
      collection: BLOG_COLLECTION_SLUG,
      entryId: "entry_launch_notes",
      slugs: ["launch-notes"],
    });

    expect(purgeMarkdownPageCacheMock).not.toHaveBeenCalled();
  });
});
