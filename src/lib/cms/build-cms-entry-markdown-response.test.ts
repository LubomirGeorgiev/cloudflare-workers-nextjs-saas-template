import type { JSONContent } from "@tiptap/core";
import { describe, expect, test, vi } from "vitest";

import type { GetCmsCollectionResult } from "@/lib/cms/entry";

vi.mock("server-only", () => ({}));

const { buildCmsEntryMarkdown } = await import("./build-cms-entry-markdown-response");

function docEntry(content: JSONContent): GetCmsCollectionResult {
  return {
    collection: "docs",
    slug: "guide",
    title: "Guide",
    seoDescription: null,
    content,
    createdAt: new Date("2026-08-01T10:00:00.000Z"),
    updatedAt: new Date("2026-08-01T10:00:00.000Z"),
  } as unknown as GetCmsCollectionResult;
}

describe("buildCmsEntryMarkdown", () => {
  test("frames the complete article with metadata and standard Markdown", () => {
    const content: JSONContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Release notes" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Important detail",
              marks: [{ type: "highlight" }, { type: "underline" }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Internal article",
              marks: [{ type: "link", attrs: { href: "/blog/another-article" } }],
            },
            { type: "text", text: " and " },
            {
              type: "text",
              text: "account page",
              marks: [{ type: "link", attrs: { href: "/dashboard" } }],
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "text" },
          content: [{ type: "text", text: "# keep code heading\n==keep code markers==" }],
        },
      ],
    };
    const entry = {
      collection: "blog",
      slug: "release-notes",
      title: "Release notes",
      seoDescription: "A complete release summary.",
      content,
      publishedAt: new Date("2026-08-01T10:00:00.000Z"),
      createdAt: new Date("2026-07-31T10:00:00.000Z"),
      updatedAt: new Date("2026-08-02T10:00:00.000Z"),
      createdByUser: {
        id: "author-1",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        avatar: null,
      },
      tags: [
        {
          tag: {
            id: "tag-1",
            name: "Engineering",
            slug: "engineering",
          },
        },
      ],
    } as unknown as GetCmsCollectionResult;

    const markdown = buildCmsEntryMarkdown({
      entry,
      sourceUrl: "https://example.com/blog/release-notes",
    });

    expect(markdown.match(/^# Release notes$/gm)).toHaveLength(1);
    expect(markdown).toContain("A complete release summary.");
    expect(markdown).toContain("Source: https://example.com/blog/release-notes");
    expect(markdown).toContain("Author: Ada Lovelace");
    expect(markdown).toContain("Published: 2026-08-01");
    expect(markdown).toContain("Updated: 2026-08-02");
    expect(markdown).toContain("Tags: Engineering");
    expect(markdown).toMatch(/<(mark|u)><(mark|u)>Important detail<\/(mark|u)><\/(mark|u)>/);
    expect(markdown).toContain("==keep code markers==");
    expect(markdown).toContain("# keep code heading");
    expect(markdown).toContain(
      "[Internal article](https://example.com/blog/another-article.md)",
    );
    expect(markdown).toContain("[account page](https://example.com/dashboard)");
    expect(markdown).not.toMatch(/(^|\s)==Important detail==/);
    expect(markdown).not.toMatch(/(^|\s)\+\+Important detail\+\+/);
  });

  test("reserves the only level-one heading for the page title", () => {
    const content: JSONContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Main section" }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Subsection" }],
        },
      ],
    };
    const markdown = buildCmsEntryMarkdown({
      entry: docEntry(content),
      sourceUrl: "https://example.com/docs/guide",
    });

    expect(markdown.match(/^# /gm)).toHaveLength(1);
    expect(markdown).toContain("## Main section");
    expect(markdown).toContain("### Subsection");
  });

  test("shifts prose headings after a code block that holds a fence line", () => {
    const content: JSONContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Main section" }],
        },
        {
          type: "codeBlock",
          attrs: { language: "text" },
          content: [{ type: "text", text: "```\ninner" }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "After the block" }],
        },
      ],
    };

    const markdown = buildCmsEntryMarkdown({
      entry: docEntry(content),
      sourceUrl: "https://example.com/docs/guide",
    });

    // The serializer grows the fence past the inner run, so that run is code, not a boundary.
    expect(markdown).toContain("````text\n```\ninner\n````");
    expect(markdown.match(/^# /gm)).toHaveLength(1);
    expect(markdown).toContain("## Main section");
    expect(markdown).toContain("### After the block");
  });

  test("keeps headings inside a code block at their written level", () => {
    const content: JSONContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Main section" }],
        },
        {
          type: "codeBlock",
          attrs: { language: "text" },
          content: [{ type: "text", text: "# still code\n```\n## also still code\n```" }],
        },
      ],
    };

    const markdown = buildCmsEntryMarkdown({
      entry: docEntry(content),
      sourceUrl: "https://example.com/docs/guide",
    });

    expect(markdown).toMatch(/^# still code$/m);
    expect(markdown).toMatch(/^## also still code$/m);
    expect(markdown).not.toMatch(/^## still code$/m);
    expect(markdown).not.toMatch(/^### also still code$/m);
  });

  test("keeps the body byte-exact when no code block holds a fence line", () => {
    const content: JSONContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Main section" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "Intro text." }] },
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [{ type: "text", text: "const a = 1;\n# not a heading" }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Subsection" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "Closing text." }] },
      ],
    };

    const markdown = buildCmsEntryMarkdown({
      entry: docEntry(content),
      sourceUrl: "https://example.com/docs/guide",
    });

    expect(markdown).toBe(
      "# Guide\n\nSource: https://example.com/docs/guide\nPublished: 2026-08-01\n"
      + "Updated: 2026-08-01\n\n## Main section\n\nIntro text.\n\n```ts\nconst a = 1;\n"
      + "# not a heading\n```\n\n### Subsection\n\nClosing text.\n",
    );
  });
});
