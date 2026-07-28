import { describe, expect, test, vi } from "vitest";
import type { JSONContent } from "@tiptap/core";

import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";

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

const { buildDocsEntryArtifacts, getCachedDocsEntryArtifacts } = await import("./docs-entry-artifacts");

// A non-default locale proves the lookup forwards the requested locale rather than defaulting,
// derived from config so it survives locale renames; single-locale forks fall back harmlessly.
const TRANSLATION_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE) ?? DEFAULT_LOCALE;

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

  test("builds reusable markdown and table-of-contents artifacts", () => {
    const artifacts = buildDocsEntryArtifacts(content);

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
    expect(artifacts.markdown).toContain("Getting Started");
    expect(artifacts.markdown).toContain("Install the template.");
  });

  test("loads content inside the cached function", async () => {
    getCmsEntryBySlugMock.mockResolvedValue({
      content,
    });

    const artifacts = await getCachedDocsEntryArtifacts({
      collectionSlug: "docs",
      slug: "getting-started",
      locale: TRANSLATION_LOCALE,
    });

    expect(getCmsEntryBySlugMock).toHaveBeenCalledWith({
      collectionSlug: "docs",
      slug: "getting-started",
      locale: TRANSLATION_LOCALE,
      status: "published",
    });
    expect(setCacheScopeMock).toHaveBeenCalledWith({
      tags: ["cms-entry-docs-getting-started"],
      ttl: "8 hours",
    });
    expect(artifacts?.markdown).toContain("Getting Started");
  });
});
