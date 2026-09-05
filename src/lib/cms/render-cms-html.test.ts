import { describe, expect, test, vi } from "vitest";
import type { JSONContent } from "@tiptap/core";

import { renderToHTMLString } from "@tiptap/static-renderer/pm/html-string";
import { getTiptapBaseExtensions } from "@/lib/tiptap-base-extensions";
import { ALERT_BLOCK_VARIANTS } from "@/components/tiptap-node/alert-block/alert-block-types";

import { CMS_IMAGES_API_ROUTE } from "@/constants";
import { ALERT_BLOCK_NODE_NAME } from "@/constants/cms-content-nodes";

vi.mock("server-only", () => ({}));

const { renderCmsContentToHtml } = await import("./render-cms-html");

function htmlFor(content: JSONContent): string {
  return renderCmsContentToHtml({ content });
}

describe("renderCmsContentToHtml", () => {
  test("omits upload placeholders and empty images, including nested blocks", () => {
    const content: JSONContent = { type: "doc", content: [
      { type: "imageUpload", attrs: { accept: "image/*", maxSize: 5242880, limit: 3 } },
      { type: "image", attrs: { src: null } },
      { type: "image", attrs: { src: "  " } },
      { type: "blockquote", content: [
        { type: "imageUpload" },
        { type: "paragraph", content: [{ type: "text", text: "Keep this text." }] },
      ] },
    ] };
    const before = JSON.stringify(content);

    expect(htmlFor(content)).toBe("<blockquote><p>Keep this text.</p></blockquote>");
    expect(JSON.stringify(content)).toBe(before);
  });

  test("stamps table-of-contents ids onto headings", () => {
    const content: JSONContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Getting Started" }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Getting Started" }],
        },
      ],
    };

    const html = htmlFor(content);

    expect(html).toContain('id="getting-started"');
    expect(html).toContain('id="getting-started-2"');
    expect(html).toContain("scroll-mt-24");
  });

  test("escapes HTML in paragraph text", () => {
    const html = htmlFor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "<script>alert(1)</script>" }],
        },
      ],
    });

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  test("highlights a registered code language", () => {
    const html = htmlFor({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "javascript" },
          content: [{ type: "text", text: "const n = 1;" }],
        },
      ],
    });

    expect(html).toContain('class="language-javascript"');
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("const");
  });

  test("wraps images and preserves CMS image urls", () => {
    const src = `${CMS_IMAGES_API_ROUTE}/posts/hero.png`;
    const html = htmlFor({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src, alt: "Hero", width: 800, height: 400 },
        },
      ],
    });

    expect(html).toContain('<div class="my-6">');
    expect(html).toContain('srcset="');
    expect(html).toContain('sizes="(max-width: 768px) 100vw');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('width="800"');
    expect(html).toContain('height="400"');
    expect(html).toContain(encodeURIComponent(src));
    expect(html).toContain("q=80");
    expect(html).toContain('alt="Hero"');
  });

  test("renders an alert block as static HTML", () => {
    const html = htmlFor({
      type: "doc",
      content: [
        {
          type: ALERT_BLOCK_NODE_NAME,
          attrs: {
            title: "Watch this",
            body: "Do not skip the Worker.",
            variant: "warning",
          },
        },
      ],
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain("Watch this");
    expect(html).toContain("Do not skip the Worker.");
  });
  test("escapes image attributes without changing external URLs", () => {
    const html = htmlFor({ type: "doc", content: [{ type: "image", attrs: {
      src: "https://example.com/photo.png",
      alt: '\" onerror=\"alert(1)',
      title: "<script>unsafe</script>",
    } }] });
    expect(html).toContain('src="https://example.com/photo.png"');
    expect(html).toContain('&quot; onerror=&quot;alert(1)');
    expect(html).not.toContain(' onerror="');
    expect(html).not.toContain("<script>");
  });

  test("keeps heading IDs stable across calls and empty headings", () => {
    const content: JSONContent = { type: "doc", content: [
      { type: "heading", attrs: { level: 2 } },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Next" }] },
    ] };
    const first = htmlFor(content);
    expect(first).toContain('id="next"');
    expect(htmlFor(content)).toBe(first);
  });

  test("escapes code for an unknown language", () => {
    const html = htmlFor({ type: "doc", content: [{ type: "codeBlock",
      attrs: { language: "unsupported" },
      content: [{ type: "text", text: "<script>alert(1)</script>" }],
    }] });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  test.each(ALERT_BLOCK_VARIANTS)("uses the alert extension for %s output", (variant) => {
    const content: JSONContent = { type: "doc", content: [{ type: ALERT_BLOCK_NODE_NAME, attrs: {
      title: '<Notice & "details">', body: "First line\nSecond line", variant,
    } }] };
    const html = htmlFor(content);
    expect(html).toBe(renderToHTMLString({ content, extensions: getTiptapBaseExtensions() }));
    expect(html).toContain('data-type="alert-block"');
    expect(html).toContain(`data-variant="${variant}"`);
    expect(html).toContain("&lt;Notice &amp;");
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(html).not.toContain("contenteditable");
  });

  test("preserves heading marks and alignment without changing the source document", () => {
    const content: JSONContent = { type: "doc", content: [{ type: "heading", attrs: { level: 3, textAlign: "right" },
      content: [{ type: "text", text: "Aligned title", marks: [{ type: "bold" }] }],
    }] };
    const before = JSON.stringify(content);
    const html = htmlFor(content);
    expect(html).toContain("<h3");
    expect(html).toContain('style="text-align: right"');
    expect(html).toContain('id="aligned-title"');
    expect(html).toContain("<strong>Aligned title</strong>");
    expect(JSON.stringify(content)).toBe(before);
  });

  test("keeps an image source for HTML import and honors the CMS path boundary", () => {
    const src = `${CMS_IMAGES_API_ROUTE}/blog/image.png`;
    const html = htmlFor({ type: "doc", content: [{ type: "image", attrs: { src } }] });
    expect(html).toContain(`data-cms-src="${src}"`);
    const other = `${CMS_IMAGES_API_ROUTE}-other/image.png`;
    expect(htmlFor({ type: "doc", content: [{ type: "image", attrs: { src: other } }] })).not.toContain("srcset");
  });

});
