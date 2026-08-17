import { describe, expect, test, vi } from "vitest";

const {
  buildLlmsTxtContentMock,
  getCmsCollectionMock,
  getCmsNavigationTreeMock,
  setCacheScopeMock,
} = vi.hoisted(() => ({
  buildLlmsTxtContentMock: vi.fn(async () => "# Docs\n"),
  getCmsCollectionMock: vi.fn(),
  getCmsNavigationTreeMock: vi.fn(),
  setCacheScopeMock: vi.fn(),
}));

vi.mock("@/lib/cms/build-llms-txt", () => ({
  buildLlmsTxtContent: buildLlmsTxtContentMock,
}));

vi.mock("@/lib/cms/cms-navigation-repository", () => ({
  getCmsNavigationTree: getCmsNavigationTreeMock,
}));

vi.mock("@/lib/cms/entry", () => ({
  getCmsCollection: getCmsCollectionMock,
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

const { GET } = await import("./route");

describe("/llms.txt", () => {
  test("serves the generated global body", async () => {
    getCmsCollectionMock.mockResolvedValue([{ id: "post" }]);
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
    expect(buildLlmsTxtContentMock).toHaveBeenCalledWith({
      blogEntries: [{ id: "post" }],
      docsNodes: [
        {
          id: "intro",
          title: "Intro",
          children: [],
        },
      ],
    });
    expect(setCacheScopeMock).toHaveBeenCalledWith({
      tags: ["cms-navigation-docs", "cms-collection-docs", "cms-collection-blog"],
      ttl: "8 hours",
    });
  });
});
