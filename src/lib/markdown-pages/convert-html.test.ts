import { describe, expect, test } from "vitest";

import { LLMS_DESCRIBED_BY_RELATION, SITE_NAME } from "@/constants";
import {
  MARKDOWN_DIRECTIVE_ATTRIBUTE,
  MARKDOWN_DIRECTIVES,
} from "@/constants/markdown-directives";

import { convertHtmlToMarkdown } from "./convert-html";

// The frame ends with this pointer, so an agent that keeps only the body still finds the index.
const INDEX_LINE = `Index: ${LLMS_DESCRIBED_BY_RELATION.href}`;
const SKIP = `${MARKDOWN_DIRECTIVE_ATTRIBUTE}="${MARKDOWN_DIRECTIVES.skip}"`;
const UNWRAP = `${MARKDOWN_DIRECTIVE_ATTRIBUTE}="${MARKDOWN_DIRECTIVES.unwrap}"`;

/** The root layout stamps every page title with this template — see `src/utils/root-metadata.ts`. */
function documentTitle(pageTitle: string): string {
  return `${pageTitle} - ${SITE_NAME}`;
}

function page({ head, body }: { head: string; body: string }): string {
  return `<html><head>${head}</head><body>${body}</body></html>`;
}

describe("convertHtmlToMarkdown", () => {
  // The golden frame of the scraped-page surface. The CMS entry surface has its own golden test in
  // `src/lib/cms/build-cms-entry-markdown-response.test.ts`; both frames come from one builder, so
  // a change to either one that the other does not share fails here.
  test("frames the whole document byte for byte", async () => {
    const markdown = await convertHtmlToMarkdown({
      html: page({
        head: `
          <title>${documentTitle("Terms of Service")}</title>
          <meta name="description" content="The  legal
          terms.">
        `,
        body: `
          <main>
            <h1>Terms of Service</h1>
            <p>Read <a href="/privacy">the policy</a>.</p>
            <h2>Details</h2>
          </main>
        `,
      }),
      sourceUrl: "https://example.com/terms",
    });

    expect(markdown).toBe(
      "# Terms of Service\n\nThe legal terms.\n\nSource: https://example.com/terms\n"
      + `${INDEX_LINE}\n\nRead [the policy](https://example.com/privacy.md).\n\n## Details\n`,
    );
  });

  test("keeps main content and removes page chrome and hidden content", async () => {
    const markdown = await convertHtmlToMarkdown({
      html: page({
        head: `
          <title>${documentTitle("Terms of Service")}</title>
          <meta name="description" content="The legal terms.">
        `,
        body: `
          <nav>Site navigation</nav>
          <main>
            <!-- React stream marker -->
            <h1>Terms of Service</h1>
            <p>Read <a href="/policy">the policy</a>.</p>
            <button>Copy</button>
            <p ${SKIP} aria-hidden="true">Decorative text</p>
            <template>Stream shell</template>
            <table><tbody><tr><td>Plan</td><td>Limit</td></tr></tbody></table>
          </main>
        `,
      }),
      sourceUrl: "https://example.com/terms",
    });

    expect(markdown).not.toBeNull();
    // The frame heading is the page `<h1>`, never the suffixed document title.
    expect(markdown!.split("\n")[0]).toBe("# Terms of Service");
    expect(markdown).toContain("The legal terms.");
    expect(markdown).toContain("Source: https://example.com/terms");
    expect(markdown).toContain("[the policy](https://example.com/policy)");
    expect(markdown!.match(/^# /gm)).toHaveLength(1);
    expect(markdown).not.toContain("Site navigation");
    expect(markdown).not.toContain("Decorative text");
    expect(markdown).not.toContain("Stream shell");
    expect(markdown).not.toContain("Copy");
    expect(markdown).not.toContain("React stream marker");
  });

  // `aria-hidden` answers assistive technology only. A page that also wants an element out of the
  // Markdown carries both attributes, so removing one never moves the other.
  test("keeps content that is hidden from assistive technology but not skipped", async () => {
    const markdown = await convertHtmlToMarkdown({
      html: page({
        head: `<title>${documentTitle("Terms of Service")}</title>`,
        body: `
          <main>
            <h1>Terms of Service</h1>
            <p aria-hidden="true">Duplicated for screen readers.</p>
          </main>
        `,
      }),
      sourceUrl: "https://example.com/terms",
    });

    expect(markdown).toContain("Duplicated for screen readers.");
  });

  test("unwraps a declared interactive element and drops every other one", async () => {
    const markdown = await convertHtmlToMarkdown({
      html: page({
        head: `<title>${documentTitle("Home")}</title>`,
        body: `
          <main>
            <h1>Ship your SaaS<br>to the edge.</h1>
            <h2>Questions, answered</h2>
            <h3><button ${UNWRAP} aria-controls="faq-answer">Is this free?</button></h3>
            <div id="faq-answer" hidden="until-found">
              <p>Yes, it is free and open source.</p>
            </div>
            <h3><button aria-controls="menu">Page action</button></h3>
          </main>
        `,
      }),
      sourceUrl: "https://example.com",
    });

    expect(markdown!.split("\n")[0]).toBe("# Ship your SaaS to the edge.");
    expect(markdown).toContain("## Questions, answered");
    expect(markdown).toContain("### Is this free?");
    expect(markdown).toContain("Yes, it is free and open source.");
    expect(markdown).not.toContain("Page action");
  });

  // The real shape: the document title carries the site-name suffix, the page heading does not.
  test("frames the page heading even when it differs from the document title", async () => {
    const markdown = await convertHtmlToMarkdown({
      html: page({
        head: `<title>${documentTitle("Landing page meta title")}</title>`,
        body: `
          <main>
            <div><h1>Ship your product</h1></div>
            <p>Body copy.</p>
          </main>
        `,
      }),
      sourceUrl: "https://example.com",
    });

    expect(markdown!.split("\n")[0]).toBe("# Ship your product");
    expect(markdown!.match(/^# /gm)).toHaveLength(1);
    expect(markdown).not.toContain("Landing page meta title");
    expect(markdown).toContain("Body copy.");
  });

  test("falls back to the document title without the site-name suffix", async () => {
    const markdown = await convertHtmlToMarkdown({
      html: page({
        head: `<title>${documentTitle("Privacy Policy")}</title>`,
        body: "<main><h2>Data we store</h2><p>Body copy.</p></main>",
      }),
      sourceUrl: "https://example.com/privacy",
    });

    expect(markdown!.split("\n")[0]).toBe("# Privacy Policy");
    expect(markdown!.match(/^# /gm)).toHaveLength(1);
    expect(markdown).toContain("## Data we store");
  });

  test("returns null when the page has no main element", async () => {
    const markdown = await convertHtmlToMarkdown({
      html: page({
        head: `<title>${documentTitle("Terms of Service")}</title>`,
        body: "<div><h1>Terms of Service</h1><p>Body copy.</p></div>",
      }),
      sourceUrl: "https://example.com/terms",
    });

    expect(markdown).toBeNull();
  });

  test("returns null when neither the page nor the document names a title", async () => {
    const markdown = await convertHtmlToMarkdown({
      html: page({ head: "", body: "<main><p>Body copy.</p></main>" }),
      sourceUrl: "https://example.com/terms",
    });

    expect(markdown).toBeNull();
  });

  test("removes a sidebar, removes a repeated title, and separates adjacent links", async () => {
    const markdown = await convertHtmlToMarkdown({
      html: page({
        head: `<title>${documentTitle("Article")}</title>`,
        body: `
          <main>
            <aside>Page chrome</aside>
            <article>
              <header><h1>Article</h1><a href="/author">Author</a><a href="/tag">Tag</a></header>
              <h1>Article</h1>
              <h2>Details</h2>
            </article>
          </main>
        `,
      }),
      sourceUrl: "https://example.com/article",
    });

    expect(markdown!.match(/^# Article$/gm)).toHaveLength(1);
    expect(markdown).toContain(
      "[Author](https://example.com/author) [Tag](https://example.com/tag)",
    );
    expect(markdown).toContain("## Details");
    expect(markdown).not.toContain("Page chrome");
  });

  // JSX writes no text node between sibling inline elements, so the serializer would run their
  // text together. The converter owns the spacing so no component has to carry a `{" "}` literal.
  test("separates adjacent inline elements of every kind", async () => {
    const markdown = await convertHtmlToMarkdown({
      html: page({
        head: `<title>${documentTitle("Reference")}</title>`,
        body: `
          <main>
            <h1>Reference</h1>
            <p><code>profile:read</code><code>profile:write</code></p>
            <p><span>Scope</span><code>team:read</code></p>
            <p><strong>Bold</strong><em>Italic</em></p>
            <p><code>kept</code><button>Copy</button></p>
          </main>
        `,
      }),
      sourceUrl: "https://example.com/reference",
    });

    expect(markdown).toContain("`profile:read` `profile:write`");
    expect(markdown).toContain("Scope `team:read`");
    expect(markdown).toContain("**Bold** *Italic*");
    // A dropped element emits nothing, so it must not leave a trailing space behind.
    expect(markdown).toContain("`kept`\n");
    expect(markdown).not.toContain("`kept` \n");
  });

  test("keeps exactly one space when the HTML already separates two inline elements", async () => {
    const markdown = await convertHtmlToMarkdown({
      html: page({
        head: `<title>${documentTitle("Reference")}</title>`,
        body: `
          <main>
            <h1>Reference</h1>
            <p><code>first</code> <code>second</code></p>
          </main>
        `,
      }),
      sourceUrl: "https://example.com/reference",
    });

    expect(markdown).toContain("`first` `second`");
    expect(markdown).not.toContain("`first`  `second`");
  });

  test("leaves adjacent block elements alone", async () => {
    const markdown = await convertHtmlToMarkdown({
      html: page({
        head: `<title>${documentTitle("Reference")}</title>`,
        body: `
          <main>
            <h1>Reference</h1>
            <div>First block</div><div>Second block</div>
            <ul><li>First item</li><li>Second item</li></ul>
          </main>
        `,
      }),
      sourceUrl: "https://example.com/reference",
    });

    expect(markdown).toContain("First block\n\nSecond block");
    expect(markdown).toContain("- First item\n- Second item");
    expect(markdown).not.toContain("First block Second block");
  });

  test("uses the full main when a list has multiple article cards", async () => {
    const markdown = await convertHtmlToMarkdown({
      html: page({
        head: `<title>${documentTitle("Blog")}</title>`,
        body: `
          <main>
            <h1>Blog</h1>
            <a href="/blog/first"><article><time>Today</time><h2>First post</h2><p>First summary.</p></article></a>
            <a href="/blog/second"><article><time>Yesterday</time><h2>Second post</h2><p>Second summary.</p></article></a>
          </main>
        `,
      }),
      sourceUrl: "https://example.com/blog",
    });

    expect(markdown).toContain("# Blog");
    expect(markdown).toContain("[First post](https://example.com/blog/first.md)");
    expect(markdown).toContain("[Second post](https://example.com/blog/second.md)");
    expect(markdown!.match(/https:\/\/example\.com\/blog\/first\.md/g)).toHaveLength(1);
    expect(markdown).toContain("First summary.");
  });

  test("keeps the list heading when the list has one article card", async () => {
    const markdown = await convertHtmlToMarkdown({
      html: page({
        head: `<title>${documentTitle("Git - Blog Tags")}</title>`,
        body: `
          <main>
            <h1>Git</h1>
            <p>Posts about Git.</p>
            <a href="/blog/first"><article><h2>First post</h2></article></a>
          </main>
        `,
      }),
      sourceUrl: "https://example.com/blog/tags/git",
    });

    expect(markdown!.split("\n")[0]).toBe("# Git");
    expect(markdown).toContain("Posts about Git.");
    expect(markdown).toContain("## [First post](https://example.com/blog/first.md)");
  });

  test("keeps fragments and makes internal images absolute", async () => {
    const markdown = await convertHtmlToMarkdown({
      html: page({
        head: `<title>${documentTitle("Resources")}</title>`,
        body: `
          <main>
            <h1>Resources</h1>
            <a href="#details">Details</a>
            <img src="/images/guide.png" alt="Guide">
          </main>
        `,
      }),
      sourceUrl: "https://example.com/resources",
    });

    expect(markdown).toContain("[Details](#details)");
    expect(markdown).toContain("![Guide](https://example.com/images/guide.png)");
  });

  test("writes a multiline HTML heading as one ATX heading", async () => {
    const markdown = await convertHtmlToMarkdown({
      html: page({
        head: `<title>${documentTitle("Home")}</title>`,
        body: "<main><h1>Home</h1><h2>One command.<br>Yours to ship.</h2></main>",
      }),
      sourceUrl: "https://example.com",
    });

    expect(markdown).toContain("## One command. Yours to ship.");
    expect(markdown).not.toMatch(/^[-=]{3,}$/m);
  });

  test("rewrites all internal public page links to Markdown routes", async () => {
    const markdown = await convertHtmlToMarkdown({
      html: page({
        head: `<title>${documentTitle("Links")}</title>`,
        body: `
          <main>
            <h1>Links</h1>
            <a href="/">Home</a>
            <a href="/blog/post?from=tag#details">Post</a>
            <a href="/blog/tags/nextjs">Tag</a>
            <a href="/docs/getting-started/introduction">Docs</a>
            <a href="/es">Spanish home</a>
            <a href="/es/blog/post">Spanish post</a>
            <a href="/dashboard">Dashboard</a>
            <a href="https://other.example/blog/post">External</a>
          </main>
        `,
      }),
      sourceUrl: "https://example.com/blog/tags/nextjs",
    });

    expect(markdown).toContain("[Home](https://example.com/index.md)");
    expect(markdown).toContain("[Post](https://example.com/blog/post.md?from=tag#details)");
    expect(markdown).toContain("[Tag](https://example.com/blog/tags/nextjs.md)");
    expect(markdown).toContain(
      "[Docs](https://example.com/docs/getting-started/introduction.md)",
    );
    expect(markdown).toContain("[Spanish home](https://example.com/es/index.md)");
    expect(markdown).toContain("[Spanish post](https://example.com/es/blog/post.md)");
    expect(markdown).toContain("[Dashboard](https://example.com/dashboard)");
    expect(markdown).toContain("[External](https://other.example/blog/post)");
  });
});
