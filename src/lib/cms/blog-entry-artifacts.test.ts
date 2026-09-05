import { describe, expect, test, vi } from "vitest";
import type { JSONContent } from "@tiptap/core";

import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import type { GetCmsCollectionResult } from "@/lib/cms/entry";
import type { BlogEntryArtifacts } from "@/lib/cms/blog-entry-artifacts";

const { getCmsEntryBySlugMock, setCacheScopeMock } = vi.hoisted(() => ({
  getCmsEntryBySlugMock: vi.fn(),
  setCacheScopeMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/cms/entry", () => ({
  getCmsEntryBySlug: getCmsEntryBySlugMock,
}));

vi.mock("@/utils/cache", () => ({
  CACHE_TAGS: {
    cmsEntry: ({ collectionSlug, slug }: { collectionSlug: string; slug: string }) =>
      `cms-entry-${collectionSlug}-${slug}`,
  },
  setCacheScope: setCacheScopeMock,
}));

vi.stubGlobal("__MARKDOWN_BUILD_ID__", "test-build-id");

const { buildBlogEntryArtifacts, getCachedBlogEntryArtifacts } = await import("./blog-entry-artifacts");

const TRANSLATION_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE) ?? DEFAULT_LOCALE;

describe("blog entry artifacts", () => {
  const content: JSONContent = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Launch Notes" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "We shipped the HTML cache." }],
      },
    ],
  };

  function blogEntry(): GetCmsCollectionResult {
    return {
      collection: "blog",
      content,
      createdAt: new Date("2026-08-01T10:00:00.000Z"),
      locale: DEFAULT_LOCALE,
      seoDescription: "Ship notes.",
      slug: "launch-notes",
      title: "Launch notes",
      updatedAt: new Date("2026-08-02T10:00:00.000Z"),
    } as unknown as GetCmsCollectionResult;
  }

  test("builds HTML and table-of-contents artifacts without the TipTap JSON body", async () => {
    const artifacts: BlogEntryArtifacts = await buildBlogEntryArtifacts({ entry: blogEntry() });

    expect(artifacts.tableOfContents).toEqual([
      { id: "launch-notes", level: 2, text: "Launch Notes" },
    ]);
    expect(artifacts.html).toContain('id="launch-notes"');
    expect(artifacts.html).toContain("We shipped the HTML cache.");
    expect(Object.keys(artifacts).sort()).toEqual([
      "createdAt",
      "createdByUser",
      "description",
      "featuredImage",
      "featuredImageUrl",
      "html",
      "locale",
      "publishedAt",
      "slug",
      "tableOfContents",
      "tableOfContentsTree",
      "tags",
      "title",
      "updatedAt",
    ]);
    expect(artifacts.description).toBe("Ship notes.");
  });

  test("loads the published entry inside the cached function", async () => {
    const entry = blogEntry();
    getCmsEntryBySlugMock.mockResolvedValue(entry);

    const artifacts = await getCachedBlogEntryArtifacts({
      locale: TRANSLATION_LOCALE,
      slug: "launch-notes",
    });

    expect(getCmsEntryBySlugMock).toHaveBeenCalledWith({
      collectionSlug: "blog",
      slug: "launch-notes",
      locale: TRANSLATION_LOCALE,
      status: "published",
      includeRelations: { tags: true, createdByUser: true },
    });
    expect(setCacheScopeMock).toHaveBeenCalledWith({
      tags: ["cms-entry-blog-launch-notes"],
      ttl: "8 hours",
    });
    expect(artifacts?.html).toContain('id="launch-notes"');
  });
  test("extracts a description once when SEO text is absent", async () => {
    const artifacts = await buildBlogEntryArtifacts({ entry: { ...blogEntry(), seoDescription: null } });
    expect(artifacts.description).toBe("Launch Notes We shipped the HTML cache.");
  });

  test("does not render missing or unpublished entries", async () => {
    getCmsEntryBySlugMock.mockResolvedValue(null);
    expect(await getCachedBlogEntryArtifacts({ locale: DEFAULT_LOCALE, slug: "draft" })).toBeNull();
  });

});
