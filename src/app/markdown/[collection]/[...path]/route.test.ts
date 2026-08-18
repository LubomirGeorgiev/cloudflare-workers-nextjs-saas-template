import { beforeEach, describe, expect, test, vi } from "vitest";

import { DEFAULT_LOCALE } from "@/i18n/config";

// Type-only import: erased at runtime, so it does not pull the repository's top-level
// `getDB`/drizzle import into this unit-test suite.
import type { CmsNavigationTreeNode } from "@/lib/cms/cms-navigation-repository";

const QUOTA = {
  limit: 5,
  remaining: 4,
  resetSeconds: 60,
  windowInSeconds: 60,
};
const REDIRECT_FROM_SLUG = "old-page";
const REDIRECT_TO_PATH = "/docs/new-page";

const { consumeRateLimitMock } = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/utils/with-rate-limit", () => {
  class RateLimitError extends Error {
    readonly retryAfterSeconds: number;
    readonly quota?: {
      limit: number;
      remaining: number;
      resetSeconds: number;
      windowInSeconds: number;
    };

    constructor(retryAfterSeconds: number, quota?: RateLimitError["quota"]) {
      super(`Rate limit exceeded. Try again in ${retryAfterSeconds}s.`);
      this.name = "RateLimitError";
      this.retryAfterSeconds = retryAfterSeconds;
      this.quota = quota;
    }
  }

  return {
    consumeRateLimit: consumeRateLimitMock,
    RATE_LIMITS: {
      CMS_MARKDOWN_API: {
        identifier: "cms-markdown-api",
        limit: 5,
        windowInSeconds: 60,
      },
    },
    RateLimitError,
  };
});

vi.mock("@/lib/cms/cms-navigation-repository", () => ({
  getCmsNavigationNodeByResolvedPath: vi.fn(),
  getCmsNavigationRedirectByPath: vi.fn(),
  getCmsNavigationTree: vi.fn(),
}));

vi.mock("@/lib/cms/entry", () => ({
  getCmsEntryBySlug: vi.fn(),
}));

// Real `CACHE_TAGS`, so a change to the production tag format (its escaping included) fails the
// `cache-tag` assertions instead of passing against a hand-written copy.
vi.mock("@/utils/cache", async () => ({
  ...(await vi.importActual<typeof import("@/utils/cache")>("@/utils/cache")),
  setCacheScope: vi.fn(),
}));

vi.mock("@/lib/cms/build-cms-entry-markdown-response", () => ({
  buildCmsEntryMarkdown: vi.fn(),
}));

const { GET } = await import("./route");
const { RateLimitError } = await import("@/utils/with-rate-limit");
const navigationRepository = await import("@/lib/cms/cms-navigation-repository");
const entryRepository = await import("@/lib/cms/entry");
const { buildCmsEntryMarkdown } = await import("@/lib/cms/build-cms-entry-markdown-response");
const { buildMarkdownPagePath } = await import("@/lib/markdown-pages/page-paths");
const { localizedPathname } = await import("@/utils/i18n-urls");
const { SITE_URL } = await import("@/constants");
const { collectionSlugs } = await import("@/../cms.config");
const { DOCS_SLUG } = await import("@/lib/cms/docs-config");
const { CACHE_TAGS } = await import("@/utils/cache");

/** The navigation tree only has to be non-empty: the node lookup itself is mocked. */
const DOCS_TREE = [{ id: "nav_1" } as unknown as CmsNavigationTreeNode];

/** A collection with no navigation tree, so its entries only resolve as a bare slug. */
const BARE_SLUG_COLLECTION = collectionSlugs.find((slug) => slug !== DOCS_SLUG);

/** A navigation tree that claims nothing: no node, and no redirect either. */
function mockDocsNotFound(): void {
  vi.mocked(navigationRepository.getCmsNavigationTree).mockResolvedValue(DOCS_TREE);
  vi.mocked(navigationRepository.getCmsNavigationNodeByResolvedPath).mockReturnValue(null);
  vi.mocked(navigationRepository.getCmsNavigationRedirectByPath).mockResolvedValue(null);
}

function mockDocsRedirect({ statusCode }: { statusCode: number }): void {
  vi.mocked(navigationRepository.getCmsNavigationTree).mockResolvedValue(DOCS_TREE);
  vi.mocked(navigationRepository.getCmsNavigationNodeByResolvedPath).mockReturnValue(null);
  vi.mocked(navigationRepository.getCmsNavigationRedirectByPath).mockResolvedValue({
    toPath: REDIRECT_TO_PATH,
    statusCode,
  } as Awaited<ReturnType<typeof navigationRepository.getCmsNavigationRedirectByPath>>);
}

function expectedRedirectLocation({ download }: { download: boolean }): string {
  return buildMarkdownPagePath({
    pathname: localizedPathname({ pathname: REDIRECT_TO_PATH, locale: DEFAULT_LOCALE }),
    download,
  });
}

describe("CMS Markdown route", () => {
  beforeEach(() => {
    vi.mocked(navigationRepository.getCmsNavigationTree).mockReset();
    vi.mocked(navigationRepository.getCmsNavigationNodeByResolvedPath).mockReset();
    vi.mocked(navigationRepository.getCmsNavigationRedirectByPath).mockReset();
    vi.mocked(entryRepository.getCmsEntryBySlug).mockReset();
    vi.mocked(buildCmsEntryMarkdown).mockReset();
  });

  test("returns a problem+json 429 with the exhausted quota", async () => {
    consumeRateLimitMock.mockRejectedValueOnce(
      new RateLimitError(12, {
        limit: 5,
        remaining: 0,
        resetSeconds: 12,
        windowInSeconds: 60,
      }),
    );

    const response = await GET(
      new Request("https://example.com/markdown/docs/introduction"),
      {
        params: Promise.resolve({
          collection: "docs",
          path: ["introduction"],
        }),
      },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(response.headers.get("retry-after")).toBe("12");
    expect(response.headers.get("ratelimit-limit")).toBe("5, 5;w=60");
    expect(response.headers.get("ratelimit-remaining")).toBe("0");
    expect(response.headers.get("ratelimit-reset")).toBe("12");
    await expect(response.json()).resolves.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      retryAfter: 12,
    });
  });

  test("adds quota headers to a non-rate-limited response", async () => {
    consumeRateLimitMock.mockResolvedValueOnce({
      limit: 5,
      remaining: 4,
      resetSeconds: 60,
      windowInSeconds: 60,
    });

    const response = await GET(
      new Request("https://example.com/markdown/missing/entry"),
      {
        params: Promise.resolve({
          collection: "missing",
          path: ["entry"],
        }),
      },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("ratelimit-limit")).toBe("5, 5;w=60");
    expect(response.headers.get("ratelimit-remaining")).toBe("4");
    expect(response.headers.get("ratelimit-reset")).toBe("60");
  });

  // A quota is only non-null in production, so this pairs a CMS redirect with one: the headers of a
  // `Response.redirect` are immutable, which made every redirect throw there and return a 500.
  test("adds quota headers to a permanent CMS redirect", async () => {
    consumeRateLimitMock.mockResolvedValueOnce(QUOTA);
    mockDocsRedirect({ statusCode: 301 });

    const response = await GET(
      new Request(`https://example.com/markdown/docs/${REDIRECT_FROM_SLUG}`),
      {
        params: Promise.resolve({
          collection: "docs",
          path: [REDIRECT_FROM_SLUG],
        }),
      },
    );

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(expectedRedirectLocation({ download: false }));
    expect(response.headers.get("ratelimit-limit")).toBe("5, 5;w=60");
    expect(response.headers.get("ratelimit-remaining")).toBe("4");
    expect(response.headers.get("ratelimit-reset")).toBe("60");
  });

  test("keeps the temporary status and forwards ?download on a CMS redirect", async () => {
    consumeRateLimitMock.mockResolvedValueOnce(QUOTA);
    mockDocsRedirect({ statusCode: 302 });

    const response = await GET(
      new Request(`https://example.com/markdown/docs/${REDIRECT_FROM_SLUG}?download`),
      {
        params: Promise.resolve({
          collection: "docs",
          path: [REDIRECT_FROM_SLUG],
        }),
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(expectedRedirectLocation({ download: true }));
    expect(response.headers.get("location")).toContain("?download");
    expect(response.headers.get("ratelimit-remaining")).toBe("4");
  });

  // A build-time absolute URL would send every preview deployment's redirect to production, so the
  // whole header, not just its path, has to stay relative to the requested origin.
  test("redirects to a relative location, never to the configured site URL", async () => {
    consumeRateLimitMock.mockResolvedValueOnce(QUOTA);
    mockDocsRedirect({ statusCode: 301 });

    const response = await GET(
      new Request(`https://preview.example.com/markdown/docs/${REDIRECT_FROM_SLUG}`),
      {
        params: Promise.resolve({
          collection: "docs",
          path: [REDIRECT_FROM_SLUG],
        }),
      },
    );

    const location = response.headers.get("location")!;
    expect(location.startsWith("/")).toBe(true);
    expect(location).not.toContain(new URL(SITE_URL).host);
    expect(location).toBe(expectedRedirectLocation({ download: false }));
  });

  // `"constructor" in cmsConfig.collections` is true, so an inherited name must not pass the gate.
  test.each(["constructor", "toString"])("rejects the inherited name %s as a collection", async (
    collection,
  ) => {
    consumeRateLimitMock.mockResolvedValueOnce(QUOTA);

    const response = await GET(
      new Request(`https://example.com/markdown/${collection}/entry`),
      {
        params: Promise.resolve({ collection, path: ["entry"] }),
      },
    );

    expect(response.status).toBe(404);
  });

  // The docs navigation tree is the authority: an entry it does not list stays unreachable, exactly
  // as it is for a reader, instead of falling back to a bare slug lookup.
  test("returns 404 for a docs slug the navigation tree does not list", async () => {
    consumeRateLimitMock.mockResolvedValueOnce(QUOTA);
    mockDocsNotFound();

    const response = await GET(
      new Request("https://example.com/markdown/docs/unlisted"),
      {
        params: Promise.resolve({ collection: DOCS_SLUG, path: ["unlisted"] }),
      },
    );

    expect(response.status).toBe(404);
    expect(entryRepository.getCmsEntryBySlug).not.toHaveBeenCalled();
  });

  test("tags a docs Markdown response with its entry and path dependencies", async () => {
    const slug = "introduction";
    const markdown = "# Introduction\n";

    consumeRateLimitMock.mockResolvedValueOnce(QUOTA);
    vi.mocked(navigationRepository.getCmsNavigationTree).mockResolvedValue(DOCS_TREE);
    vi.mocked(navigationRepository.getCmsNavigationNodeByResolvedPath).mockReturnValue({
      nodeType: "page",
      entry: { slug },
      resolvedPath: `/docs/${slug}`,
    } as unknown as CmsNavigationTreeNode);
    vi.mocked(entryRepository.getCmsEntryBySlug).mockResolvedValue({
      collection: DOCS_SLUG,
      locale: DEFAULT_LOCALE,
      slug,
    } as Awaited<ReturnType<typeof entryRepository.getCmsEntryBySlug>>);
    vi.mocked(buildCmsEntryMarkdown).mockReturnValue(markdown);

    const response = await GET(
      new Request(`https://example.com/markdown/docs/${slug}`),
      {
        params: Promise.resolve({ collection: DOCS_SLUG, path: [slug] }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-tag")).toBe(
      [
        CACHE_TAGS.cmsEntry({ collectionSlug: DOCS_SLUG, slug }),
        CACHE_TAGS.cmsNavigation(DOCS_SLUG),
        CACHE_TAGS.cmsRedirect(DOCS_SLUG),
      ].join(","),
    );
    await expect(response.text()).resolves.toBe(markdown);
  });

  // The other side of the same rule: a collection with no navigation tree has only the bare slug,
  // so that fallback has to stay.
  test.skipIf(!BARE_SLUG_COLLECTION)(
    "resolves a bare entry slug for a collection without a navigation tree",
    async () => {
      const collection = BARE_SLUG_COLLECTION!;
      const slug = "launch";
      const markdown = "# Launch\n";

      consumeRateLimitMock.mockResolvedValueOnce(QUOTA);
      vi.mocked(entryRepository.getCmsEntryBySlug).mockResolvedValue({
        collection,
        locale: DEFAULT_LOCALE,
        slug,
      } as Awaited<ReturnType<typeof entryRepository.getCmsEntryBySlug>>);
      vi.mocked(buildCmsEntryMarkdown).mockReturnValue(markdown);

      const response = await GET(
        new Request(`https://example.com/markdown/${collection}/${slug}`),
        {
          params: Promise.resolve({ collection, path: [slug] }),
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
      expect(response.headers.get("cache-tag")).toBe(
        CACHE_TAGS.cmsEntry({ collectionSlug: collection, slug }),
      );
      await expect(response.text()).resolves.toBe(markdown);
      expect(navigationRepository.getCmsNavigationTree).not.toHaveBeenCalled();
    },
  );
});
