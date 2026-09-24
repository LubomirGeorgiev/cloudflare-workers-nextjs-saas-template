import { beforeEach, describe, expect, test, vi } from "vitest";

import { AUTH_SESSION_PRESENT_COOKIE_NAME } from "@/constants";
import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALE_COOKIE_NAME, type Locale } from "@/i18n/config";
import { BLOG_BASE_PATH } from "@/lib/blog-routing";
import { localizedPathname } from "@/i18n/localized-pathname";

vi.mock("server-only", () => ({}));

// A fork serves one locale or several, so both are covered whichever one this checkout ships. The
// served set is narrowed rather than `LOCALE_DETECTION` alone, because production derives it from that set.
const servedLocales = vi.hoisted(() => ({ single: false }));

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

const { resolveEdgeHtmlCacheEntry } = await import("./edge-html-cache");

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
