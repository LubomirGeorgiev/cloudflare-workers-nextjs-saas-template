import { describe, expect, test, vi } from "vitest";
import type { JSONContent } from "@tiptap/core";

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
    CMS_ENTRY: "cms-entry",
    cmsEntry: ({ collectionSlug, slug }: { collectionSlug: string; slug: string }) =>
      `cms-entry-${collectionSlug}-${slug}`,
  },
  setCacheScope: setCacheScopeMock,
}));

const { buildDocsEntryArtifacts, getCachedDocsEntryArtifacts } = await import("./docs-entry-artifacts");

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
    });

    expect(getCmsEntryBySlugMock).toHaveBeenCalledWith({
      collectionSlug: "docs",
      slug: "getting-started",
      status: "published",
    });
    expect(setCacheScopeMock).toHaveBeenCalledWith({
      tags: ["cms-entry", "cms-entry-docs-getting-started"],
      ttl: "8 hours",
    });
    expect(artifacts?.markdown).toContain("Getting Started");
  });
});
