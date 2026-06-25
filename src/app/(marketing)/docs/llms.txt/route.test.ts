import { describe, expect, test, vi } from "vitest";

const { buildDocsLlmsTxtContentMock, getCmsNavigationTreeMock, setCacheScopeMock } = vi.hoisted(() => ({
  buildDocsLlmsTxtContentMock: vi.fn(() => "# Docs\n"),
  getCmsNavigationTreeMock: vi.fn(),
  setCacheScopeMock: vi.fn(),
}));

vi.mock("@/lib/cms/build-docs-llms-txt", () => ({
  buildDocsLlmsTxtContent: buildDocsLlmsTxtContentMock,
}));

vi.mock("@/lib/cms/cms-navigation-repository", () => ({
  getCmsNavigationTree: getCmsNavigationTreeMock,
}));

vi.mock("@/lib/cms/docs-config", () => ({
  DOCS_SLUG: "docs",
}));

vi.mock("@/utils/cache", () => ({
  CACHE_TAGS: {
    cmsCollection: (collectionSlug: string) => `cms-collection-${collectionSlug}`,
    cmsNavigation: (navigationKey: string) => `cms-navigation-${navigationKey}`,
  },
  setCacheScope: setCacheScopeMock,
}));

vi.mock("@/constants", () => ({
  SITE_URL: "https://example.com",
}));

const { GET } = await import("./route");

describe("/docs/llms.txt", () => {
  test("serves the generated docs body", async () => {
    getCmsNavigationTreeMock.mockResolvedValue([
      {
        id: "intro",
        title: "Intro",
        children: [],
      },
    ]);

    const response = await GET();

    await expect(response.text()).resolves.toBe("# Docs\n");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(buildDocsLlmsTxtContentMock).toHaveBeenCalledWith([
      {
        id: "intro",
        title: "Intro",
        children: [],
      },
    ]);
    expect(setCacheScopeMock).toHaveBeenCalledWith({
      tags: ["cms-navigation-docs", "cms-collection-docs"],
      ttl: "8 hours",
    });
  });
});
