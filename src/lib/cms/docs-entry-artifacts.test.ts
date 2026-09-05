import { describe, expect, test, vi } from "vitest";
import type { JSONContent } from "@tiptap/core";

import { LLMS_DESCRIBED_BY_RELATION } from "@/constants";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import type { GetCmsCollectionResult } from "@/lib/cms/entry";
import { absoluteLocalizedUrl } from "@/utils/i18n-urls";

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

const { buildDocsEntryArtifacts, getCachedDocsEntryArtifacts } = await import("./docs-entry-artifacts");
const { buildCmsEntryMarkdown } = await import("./build-cms-entry-markdown-response");

// A non-default locale proves the lookup forwards the requested locale rather than defaulting,
// derived from config so it survives locale renames; single-locale forks fall back harmlessly.
const TRANSLATION_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE) ?? DEFAULT_LOCALE;
const SOURCE_PATHNAME = "/docs/getting-started/introduction";

describe("docs entry artifacts", () => {
  const content: JSONContent = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Getting Started" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Install the template." }],
      },
      {
        type: "heading",
        attrs: { level: 3 },
        content: [{ type: "text", text: "Configure Cloudflare" }],
      },
    ],
  };

  function docsEntry(): GetCmsCollectionResult {
    return {
      collection: "docs",
      content,
      createdAt: new Date("2026-08-01T10:00:00.000Z"),
      createdByUser: {
        id: "author-1",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
      },
      locale: DEFAULT_LOCALE,
      seoDescription: "Start here.",
      slug: "introduction",
      tags: [{ tag: { id: "tag-1", name: "Guides", slug: "guides" } }],
      title: "Introduction",
      updatedAt: new Date("2026-08-02T10:00:00.000Z"),
    } as unknown as GetCmsCollectionResult;
  }

  test("builds the framed markdown, HTML, and the table-of-contents artifacts", async () => {
    const artifacts = await buildDocsEntryArtifacts({
      entry: docsEntry(),
      sourceUrl: "https://example.com/docs/getting-started/introduction",
    });

    expect(artifacts.tableOfContents).toEqual([
      { id: "getting-started", level: 2, text: "Getting Started" },
      { id: "configure-cloudflare", level: 3, text: "Configure Cloudflare" },
    ]);
    expect(artifacts.tableOfContentsTree).toEqual([
      {
        id: "getting-started",
        level: 2,
        text: "Getting Started",
        children: [
          {
            id: "configure-cloudflare",
            level: 3,
            text: "Configure Cloudflare",
            children: [],
          },
        ],
      },
    ]);
    expect(artifacts.html).toContain('id="getting-started"');
    expect(artifacts.html).toContain('id="configure-cloudflare"');
    expect(artifacts).not.toHaveProperty("content");
    // The golden document of the copy button, framed exactly like `GET <path>.md`.
    expect(artifacts.markdown).toBe(
      "# Introduction\n\nStart here.\n\n"
      + "Source: https://example.com/docs/getting-started/introduction\n"
      + "Author: Ada Lovelace\nPublished: 2026-08-01\nUpdated: 2026-08-02\nTags: Guides\n"
      + `Index: ${LLMS_DESCRIBED_BY_RELATION.href}\n\n`
      + "## Getting Started\n\nInstall the template.\n\n### Configure Cloudflare\n",
    );
  });

  test("copies the same bytes the Markdown route serves", async () => {
    const entry = docsEntry();
    const sourceUrl = "https://example.com/docs/getting-started/introduction";

    expect((await buildDocsEntryArtifacts({ entry, sourceUrl })).markdown).toBe(
      buildCmsEntryMarkdown({ entry, sourceUrl }),
    );
  });

  test("loads the entry with the frame relations inside the cached function", async () => {
    const entry = docsEntry();
    getCmsEntryBySlugMock.mockResolvedValue(entry);

    const artifacts = await getCachedDocsEntryArtifacts({
      collectionSlug: "docs",
      locale: TRANSLATION_LOCALE,
      slug: "introduction",
      sourcePathname: SOURCE_PATHNAME,
    });

    expect(getCmsEntryBySlugMock).toHaveBeenCalledWith({
      collectionSlug: "docs",
      includeRelations: { createdByUser: true, tags: true },
      slug: "introduction",
      locale: TRANSLATION_LOCALE,
      status: "published",
    });
    expect(setCacheScopeMock).toHaveBeenCalledWith({
      tags: ["cms-entry-docs-introduction"],
      ttl: "8 hours",
    });
    // The `Source:` line follows the entry's own locale, exactly as the Markdown route builds it.
    expect(artifacts?.markdown).toBe(
      buildCmsEntryMarkdown({
        entry,
        sourceUrl: absoluteLocalizedUrl({
          pathname: SOURCE_PATHNAME,
          locale: DEFAULT_LOCALE,
        }),
      }),
    );
  });
});
