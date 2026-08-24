import { describe, expect, test, vi } from "vitest";

import { API_CATALOG_PATH, API_OPENAPI_SPEC_PATH, SITE_URL } from "@/constants";
import { getMcpEndpointUrl } from "@/constants/agent-clients";
import { INDEXED_DOCS_ROUTES } from "@/constants/docs-routes";
import { STATIC_PUBLIC_ROUTES } from "@/constants/public-routes";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { loadCatalog } from "@/i18n/message-catalogs";
import type { CmsNavigationTreeNode } from "@/lib/cms/cms-navigation-repository";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/with-rate-limit", () => ({
  RATE_LIMITS: {
    API_AUTHED: {
      limit: 300,
      windowInSeconds: 60,
    },
  },
}));

const { buildLlmsTxtContent, requireRouteCopy } = await import("./build-llms-txt");

describe("requireRouteCopy", () => {
  test("fails loudly when the copy map does not cover a route", () => {
    expect(() => requireRouteCopy({ key: "/pricing", routeCopy: new Map() }))
      .toThrowError('llms.txt is missing metadata copy for route "/pricing"');
  });

  test("returns the copy row when the map covers the route", () => {
    const copy = { summary: "Plans and prices.", title: "Pricing" };

    expect(requireRouteCopy({ key: "/pricing", routeCopy: new Map([["/pricing", copy]]) }))
      .toBe(copy);
  });
});

describe("buildLlmsTxtContent", () => {
  test("uses metadata copy and canonical .md links", async () => {
    const node = {
      nodeType: "page",
      title: "Short navigation label",
      resolvedPath: "/docs/getting-started/introduction",
      entry: {
        collection: "docs",
        slug: "introduction",
        title: "Introduction metadata title",
        seoDescription: "Start here.",
      },
      children: [],
    } as unknown as CmsNavigationTreeNode;
    const blogEntry = {
      collection: "blog",
      slug: "release-notes",
      title: "Release notes metadata title",
      seoDescription: "All release details.",
      tags: [],
      createdByUser: null,
    } as unknown as Parameters<typeof buildLlmsTxtContent>[0]["blogEntries"][number];
    const body = await buildLlmsTxtContent({ blogEntries: [blogEntry], docsNodes: [node] });
    const messages = await loadCatalog(DEFAULT_LOCALE);

    expect(body).toContain("/docs/getting-started/introduction.md");
    expect(body).toContain("[Introduction metadata title]");
    expect(body).toContain(
      `- [Introduction metadata title](${SITE_URL}/docs/getting-started/introduction.md): Start here.`,
    );
    expect(body).not.toContain("Short navigation label");
    expect(body).not.toContain("/markdown/docs/introduction");
    expect(body).toContain("/blog/release-notes.md");
    expect(body).toContain("[Release notes metadata title]");
    expect(body).toContain("## Blog");
    expect(body).toContain(messages.Client.Docs.ApiReference.meta.title);
    expect(body).toContain(messages.Landing.meta.description);
    expect(body).toContain(
      `## Search API\n\n- [Documentation search API](${SITE_URL}/api/docs/search?`,
    );
    expect(body).toContain(
      `- [API catalog](${SITE_URL}${API_CATALOG_PATH}): RFC 9727 linkset`,
    );
    expect(body).toContain(
      `- [OpenAPI document](${SITE_URL}${API_OPENAPI_SPEC_PATH}): Exact OpenAPI 3.1 contract`,
    );
    expect(body).toContain(
      `- [MCP endpoint](${getMcpEndpointUrl()}): Streamable HTTP endpoint`,
    );

    for (const route of INDEXED_DOCS_ROUTES) {
      expect(body).toContain(`${route.pathname}.md`);
    }

    for (const route of STATIC_PUBLIC_ROUTES) {
      const markdownPath = route.pathname === "/" ? "/index.md" : `${route.pathname}.md`;
      expect(body).toContain(markdownPath);
    }

    expect(body.indexOf("## Site pages")).toBeLessThan(body.indexOf("## Documentation"));
  });

  test("separates a root-level page from the group before it", async () => {
    const groupNode = {
      nodeType: "group",
      title: "Guides",
      resolvedPath: null,
      entry: null,
      children: [
        {
          nodeType: "page",
          title: "Nested label",
          resolvedPath: "/docs/guides/install",
          entry: {
            collection: "docs",
            slug: "install",
            title: "Install",
            seoDescription: "Install the app.",
          },
          children: [],
        },
      ],
    } as unknown as CmsNavigationTreeNode;
    const rootPageNode = {
      nodeType: "page",
      title: "Changelog label",
      resolvedPath: "/docs/changelog",
      entry: {
        collection: "docs",
        slug: "changelog",
        title: "Changelog",
        seoDescription: "What changed.",
      },
      children: [],
    } as unknown as CmsNavigationTreeNode;
    const body = await buildLlmsTxtContent({
      blogEntries: [],
      docsNodes: [groupNode, rootPageNode],
    });

    expect(body).toContain(
      [
        "### Guides",
        `- [Install](${SITE_URL}/docs/guides/install.md): Install the app.`,
        "",
        `- [Changelog](${SITE_URL}/docs/changelog.md): What changed.`,
      ].join("\n"),
    );
  });
});
