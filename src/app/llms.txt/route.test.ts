import { describe, expect, test, vi } from "vitest";

import { LLMS_TXT_URL } from "@/constants";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { CACHE_TAGS } from "@/utils/cache";

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

vi.mock("server-only", () => ({}));

vi.mock("@/lib/cms/build-llms-txt", () => ({
  buildLlmsTxtContent: buildLlmsTxtContentMock,
}));

vi.mock("@/lib/cms/cms-navigation-repository", () => ({
  getCmsNavigationTree: getCmsNavigationTreeMock,
}));

vi.mock("@/lib/cms/entry", () => ({
  getCmsCollection: getCmsCollectionMock,
}));

// Keep the real CACHE_TAGS so the assertions pin the production tag format, not a copy of it.
vi.mock("@/utils/cache", async (importActual) => ({
  ...(await importActual<typeof import("@/utils/cache")>()),
  setCacheScope: setCacheScopeMock,
}));

const { GET } = await import("./route");

// The route names the blog collection with this same bare literal.
const BLOG_COLLECTION_SLUG = "blog";

const EXPECTED_CACHE_TAGS = [
  CACHE_TAGS.cmsNavigation(DOCS_SLUG),
  CACHE_TAGS.cmsCollection(DOCS_SLUG),
  CACHE_TAGS.cmsCollection(BLOG_COLLECTION_SLUG),
];

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
    expect(response.headers.get("cache-tag")).toBe(EXPECTED_CACHE_TAGS.join(","));
    expect(response.headers.get("link")).toBe(`<${LLMS_TXT_URL}>; rel="describedby"`);
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
      tags: EXPECTED_CACHE_TAGS,
      ttl: "8 hours",
    });
  });
});
