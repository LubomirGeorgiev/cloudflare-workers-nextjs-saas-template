import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  AUTH_SESSION_PRESENT_COOKIE_NAME,
  SITE_DOMAIN,
  ZONE_PURGE_TAGS_PER_REQUEST,
} from "@/constants";
import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALE_COOKIE_NAME, type Locale } from "@/i18n/config";
import { BLOG_BASE_PATH } from "@/lib/blog-routing";
import { localizedPathname } from "@/i18n/localized-pathname";
import {
  EDGE_HTML_CACHE_CONTROL,
  EDGE_HTML_CACHE_ZONE_PURGED_CACHE_CONTROL,
} from "@/constants/cache-control";

vi.mock("server-only", () => ({}));

// A fork serves one locale or several, so both are covered whichever one this checkout ships. The
// served set is narrowed rather than `LOCALE_DETECTION` alone, because production derives it from that set.
const servedLocales = vi.hoisted(() => ({ single: false }));

const { getCachePurgeConfigMock, purgeZoneCachePrefixesMock, purgeZoneCacheTagsMock } = vi.hoisted(() => ({
  getCachePurgeConfigMock: vi.fn(async (): Promise<{ apiToken: string; zoneId: string } | null> => null),
  purgeZoneCachePrefixesMock: vi.fn(async (__input: { prefixes: string[] }) => undefined),
  purgeZoneCacheTagsMock: vi.fn(async (__input: { tags: string[] }) => undefined),
}));

// The zone API is the subject here; its request shape is asserted in `cloudflare-api.test.ts`.
vi.mock("@/lib/cloudflare-api", () => ({
  getCachePurgeConfig: getCachePurgeConfigMock,
  isZonePurgeConfigured: async () => (await getCachePurgeConfigMock()) !== null,
  purgeZoneCachePrefixes: purgeZoneCachePrefixesMock,
  purgeZoneCacheTags: purgeZoneCacheTagsMock,
}));

vi.mock("@/i18n/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n/config")>();

  function enabledLocales(): readonly Locale[] {
    return servedLocales.single ? [actual.DEFAULT_LOCALE] : actual.ENABLED_LOCALES;
  }

  return {
    ...actual,
    get ENABLED_LOCALES() {
      return enabledLocales();
    },
    get LOCALE_DETECTION() {
      return enabledLocales().length > 1;
    },
    isEnabledLocale: (value: string | null | undefined): value is Locale =>
      enabledLocales().includes(value as Locale),
  };
});

const {
  purgeEdgeHtmlPages,
  resolveEdgeHtmlCacheEntry,
  selectEdgeHtmlCacheAgeSeconds,
  selectEdgeHtmlCacheControl,
} = await import("./edge-html-cache");

/** A public page in every fork: the blog listing is the root of a whole public subtree. */
const CANONICAL_PATH = localizedPathname({ pathname: BLOG_BASE_PATH, locale: DEFAULT_LOCALE });

// The other spelling of the same page, whichever one `localizedPathname` makes canonical. The proxy
// answers it with a redirect, so the gate must never store or serve it.
const NON_CANONICAL_PATH = CANONICAL_PATH === BLOG_BASE_PATH
  ? `/${DEFAULT_LOCALE}${BLOG_BASE_PATH}`
  : BLOG_BASE_PATH;

const ALTERNATE_LOCALE = ENABLED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE);

/** What a fork that de-served a locale leaves in a returning visitor's browser. */
const STALE_COOKIE_LOCALE = "zz";

function resolve({
  headers = {},
  method = "GET",
  pathname = CANONICAL_PATH,
}: {
  headers?: Record<string, string>;
  method?: string;
  pathname?: string;
} = {}) {
  return resolveEdgeHtmlCacheEntry({
    headers: new Headers(headers),
    method,
    url: new URL(`https://example.com${pathname}`),
  });
}

describe("resolveEdgeHtmlCacheEntry", () => {
  beforeEach(() => {
    servedLocales.single = false;
  });

  test("resolves the canonical public page for an anonymous visitor", () => {
    expect(resolve()).toMatchObject({
      locale: DEFAULT_LOCALE,
      servedPathname: CANONICAL_PATH,
      storable: true,
    });
  });

  test("lets a HEAD read the copy but never write one", () => {
    expect(resolve({ method: "HEAD" })).toMatchObject({ storable: false });
  });

  test.each([
    ["a locale prefix in another case", { pathname: `/${DEFAULT_LOCALE.toUpperCase()}${BLOG_BASE_PATH}` }],
    ["an empty segment below the locale prefix", { pathname: `/${DEFAULT_LOCALE}/${BLOG_BASE_PATH}` }],
    ["a repeated slash the proxy collapses", { pathname: `/${CANONICAL_PATH}` }],
    ["a percent-encoded spelling of the canonical path", { pathname: CANONICAL_PATH.replace(/[a-z]$/, (c) => `%${c.charCodeAt(0).toString(16)}`) }],
    ["a signed-in visitor", { headers: { cookie: `${AUTH_SESSION_PRESENT_COOKIE_NAME}=1` } }],
    ["a client-side navigation", { headers: { rsc: "1" } }],
    ["a write method", { method: "POST" }],
    ["a query string", { pathname: `${CANONICAL_PATH}?page=2` }],
    ["the non-canonical URL of the same page", { pathname: NON_CANONICAL_PATH }],
    ["a path that is not a public page", { pathname: "/dashboard" }],
  ])("refuses %s", (_label, overrides) => {
    expect(resolve(overrides)).toBeNull();
  });

  test.runIf(ALTERNATE_LOCALE !== undefined)(
    "refuses a bare path when Accept-Language names another served locale",
    () => {
      expect(resolve({ headers: { "accept-language": `${ALTERNATE_LOCALE},${DEFAULT_LOCALE};q=0.5` } })).toBeNull();
    },
  );

  // The shared resolver drops a cookie the served set no longer holds, so the request still lands
  // on the stored locale.
  test("serves a visitor whose locale cookie the served set no longer holds", () => {
    expect(resolve({
      headers: { cookie: `${LOCALE_COOKIE_NAME}=${STALE_COOKIE_LOCALE}` },
    })).toMatchObject({ locale: DEFAULT_LOCALE });
  });

  // The prefix decides on its own, so a cookie for another locale neither blocks nor changes it.
  test.runIf(ALTERNATE_LOCALE !== undefined)(
    "serves a prefixed page whatever locale the cookie names",
    () => {
      const prefixed = localizedPathname({ pathname: BLOG_BASE_PATH, locale: ALTERNATE_LOCALE! });

      expect(resolve({
        headers: { cookie: `${LOCALE_COOKIE_NAME}=${DEFAULT_LOCALE}` },
        pathname: prefixed,
      })).toMatchObject({ locale: ALTERNATE_LOCALE, servedPathname: prefixed });
    },
  );

  // With one served locale the resolver negotiates nothing, so the signals below decide nothing
  // either and the visitor they used to send to the app can read the stored copy.
  describe("with a single served locale", () => {
    beforeEach(() => {
      servedLocales.single = true;
    });

    test.runIf(ALTERNATE_LOCALE !== undefined)("ignores Accept-Language", () => {
      expect(resolve({
        headers: { "accept-language": `${ALTERNATE_LOCALE},${DEFAULT_LOCALE};q=0.5` },
      })).not.toBeNull();
    });

    // The router no longer serves the de-served prefix, so a copy stored under it would outlive it.
    test.runIf(ALTERNATE_LOCALE !== undefined)("refuses a de-served locale prefix", () => {
      expect(resolve({
        pathname: localizedPathname({ pathname: BLOG_BASE_PATH, locale: ALTERNATE_LOCALE! }),
      })).toBeNull();
    });

    test("still refuses a signed-in visitor", () => {
      expect(resolve({
        headers: { cookie: `${AUTH_SESSION_PRESENT_COOKIE_NAME}=1` },
      })).toBeNull();
    });

    test("serves a visitor whose locale cookie the served set no longer holds", () => {
      expect(resolve({
        headers: { cookie: `${LOCALE_COOKIE_NAME}=${STALE_COOKIE_LOCALE}` },
      })).toMatchObject({ locale: DEFAULT_LOCALE });
    });
  });
});

// Without a zone purge, other data centers keep each copy for its whole TTL, so it stays short.
describe("selectEdgeHtmlCacheControl", () => {
  test("keeps the short TTL without a zone purge", () => {
    expect(selectEdgeHtmlCacheControl({ zonePurgeConfigured: false })).toBe(EDGE_HTML_CACHE_CONTROL);
  });

  test("uses the long TTL when a zone purge reaches every data center", () => {
    expect(selectEdgeHtmlCacheControl({ zonePurgeConfigured: true })).toBe(
      EDGE_HTML_CACHE_ZONE_PURGED_CACHE_CONTROL,
    );
  });
});

describe("selectEdgeHtmlCacheAgeSeconds", () => {
  const STORED_AT = 1_700_000_000_000;

  test("reports whole seconds since the copy was stored", () => {
    expect(selectEdgeHtmlCacheAgeSeconds({ storedAt: String(STORED_AT), now: STORED_AT + 2_999 }))
      .toBe(2);
  });

  test("never reports a negative age when the reader's clock runs behind", () => {
    expect(selectEdgeHtmlCacheAgeSeconds({ storedAt: String(STORED_AT), now: STORED_AT - 5_000 }))
      .toBe(0);
  });

  test.each([null, "not-a-number"])("reports no age for the stored timestamp %s", (storedAt) => {
    expect(selectEdgeHtmlCacheAgeSeconds({ storedAt, now: STORED_AT })).toBeNull();
  });
});

describe("purgeEdgeHtmlPages", () => {
  const PURGE_CONFIG = { apiToken: "token-1", zoneId: "zone-1" };
  const ENTRY_PATH = `${BLOG_BASE_PATH}/launch-notes`;
  const deleteMock = vi.fn(async (__key: string) => true);

  function servedPathnames(pathname: string): string[] {
    return ENABLED_LOCALES.map((locale) => localizedPathname({ pathname, locale }));
  }

  function keyPrefix(servedPathname: string): string {
    return `${SITE_DOMAIN}/__edge-html/test-build-id${servedPathname}`;
  }

  beforeEach(() => {
    servedLocales.single = false;
    vi.stubGlobal("caches", { default: { delete: deleteMock } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test("deletes the named pages and the subtree roots locally when there is no API token", async () => {
    const result = await purgeEdgeHtmlPages({
      pathnames: [ENTRY_PATH],
      subtreePathnames: [BLOG_BASE_PATH],
    });

    const expectedKeys = [...servedPathnames(BLOG_BASE_PATH), ...servedPathnames(ENTRY_PATH)]
      .map((served) => `https://${keyPrefix(served)}`);
    expect(deleteMock.mock.calls.map(([key]) => key).toSorted()).toEqual(expectedKeys.toSorted());
    expect(result).toEqual({ deletedCount: expectedKeys.length, zonePurge: "unconfigured" });
    expect(purgeZoneCacheTagsMock).not.toHaveBeenCalled();
    expect(purgeZoneCachePrefixesMock).not.toHaveBeenCalled();
  });

  test("purges each subtree zone-wide by key prefix, and needs no tag for a page inside it", async () => {
    getCachePurgeConfigMock.mockResolvedValueOnce(PURGE_CONFIG);

    const result = await purgeEdgeHtmlPages({
      pathnames: [ENTRY_PATH],
      subtreePathnames: [BLOG_BASE_PATH],
    });

    expect(result.zonePurge).toBe("ok");
    expect(purgeZoneCachePrefixesMock).toHaveBeenCalledOnce();
    expect(purgeZoneCachePrefixesMock).toHaveBeenCalledWith({
      ...PURGE_CONFIG,
      prefixes: servedPathnames(BLOG_BASE_PATH).map(keyPrefix),
    });
    expect(purgeZoneCacheTagsMock).not.toHaveBeenCalled();
  });

  test("purges a page outside every subtree by tag", async () => {
    getCachePurgeConfigMock.mockResolvedValueOnce(PURGE_CONFIG);

    await purgeEdgeHtmlPages({ pathnames: [ENTRY_PATH] });

    expect(purgeZoneCacheTagsMock).toHaveBeenCalledWith({
      ...PURGE_CONFIG,
      tags: servedPathnames(ENTRY_PATH).map((served) => `edge-html:test-build-id:${served}`),
    });
    expect(purgeZoneCachePrefixesMock).not.toHaveBeenCalled();
  });

  test("never throws when the zone purge fails", async () => {
    getCachePurgeConfigMock.mockResolvedValueOnce(PURGE_CONFIG);
    purgeZoneCachePrefixesMock.mockRejectedValueOnce(new Error("rate limited"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(purgeEdgeHtmlPages({
        pathnames: [],
        subtreePathnames: [BLOG_BASE_PATH],
      })).resolves.toEqual({
        deletedCount: servedPathnames(BLOG_BASE_PATH).length,
        zonePurge: "failed",
      });
      expect(consoleError).toHaveBeenCalledOnce();
    } finally {
      consoleError.mockRestore();
    }
  });

  // The API client chunks a long list; a sweep above one request must still reach every colo.
  test("sends a tag list longer than one zone request instead of skipping it", async () => {
    getCachePurgeConfigMock.mockResolvedValueOnce(PURGE_CONFIG);
    const pathnames = Array.from(
      { length: ZONE_PURGE_TAGS_PER_REQUEST + 1 },
      (__, index) => `/page-${index}`,
    );

    const result = await purgeEdgeHtmlPages({ pathnames });

    expect(result.zonePurge).toBe("ok");
    expect(purgeZoneCacheTagsMock).toHaveBeenCalledOnce();
    expect(purgeZoneCacheTagsMock.mock.calls[0]?.[0].tags.length).toBeGreaterThan(
      ZONE_PURGE_TAGS_PER_REQUEST,
    );
  });

  // The root subtree is the whole key space of this build: one prefix per served locale, no tag.
  test("purges every stored page by the root prefix", async () => {
    getCachePurgeConfigMock.mockResolvedValueOnce(PURGE_CONFIG);

    await purgeEdgeHtmlPages({ pathnames: [ENTRY_PATH], subtreePathnames: ["/"] });

    expect(purgeZoneCachePrefixesMock).toHaveBeenCalledWith({
      ...PURGE_CONFIG,
      prefixes: servedPathnames("/").map(keyPrefix),
    });
    expect(purgeZoneCacheTagsMock).not.toHaveBeenCalled();
  });

  test("reports no zone purge when nothing is named", async () => {
    await expect(purgeEdgeHtmlPages({ pathnames: [] })).resolves.toEqual({
      deletedCount: 0,
      zonePurge: "none",
    });
    expect(getCachePurgeConfigMock).not.toHaveBeenCalled();
  });
});
