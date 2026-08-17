import { describe, expect, test, vi } from "vitest";

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
    expect(body).not.toContain("Short navigation label");
    expect(body).not.toContain("/markdown/docs/introduction");
    expect(body).toContain("/blog/release-notes.md");
    expect(body).toContain("[Release notes metadata title]");
    expect(body).toContain("## Blog");
    expect(body).toContain(messages.Client.Docs.ApiReference.meta.title);

    for (const route of INDEXED_DOCS_ROUTES) {
      expect(body).toContain(`${route.pathname}.md`);
    }

    for (const route of STATIC_PUBLIC_ROUTES) {
      const markdownPath = route.pathname === "/" ? "/index.md" : `${route.pathname}.md`;
      expect(body).toContain(markdownPath);
    }

    expect(body.indexOf("## Site pages")).toBeLessThan(body.indexOf("## Documentation"));
  });
});
