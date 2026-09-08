import { beforeEach, describe, expect, test, vi } from "vitest";

import { AUTH_SESSION_PRESENT_COOKIE_NAME } from "@/constants";
import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALE_COOKIE_NAME } from "@/i18n/config";
import { BLOG_BASE_PATH } from "@/lib/blog-routing";
import { localizedPathname } from "@/utils/i18n-urls";

vi.mock("server-only", () => ({}));

// `localeDetection` is `I18N_ENABLED` in the real config, so a fork sets it either way. Mocked
// rather than assumed, so both settings are covered whichever one this checkout ships.
const localeDetection = vi.hoisted(() => ({ enabled: true }));

vi.mock("@/i18n/routing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n/routing")>();

  return {
    routing: {
      ...actual.routing,
      get localeDetection() {
        return localeDetection.enabled;
      },
    },
  };
});

const { resolveEdgeHtmlCacheEntry } = await import("./edge-html-cache");

/** A public page in every fork: the blog listing is the root of a whole public subtree. */
const CANONICAL_PATH = localizedPathname({ pathname: BLOG_BASE_PATH, locale: DEFAULT_LOCALE });

// The other spelling of the same page, whichever one `localePrefix` makes canonical. next-intl
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
    localeDetection.enabled = true;
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
    ["a signed-in visitor", { headers: { cookie: `${AUTH_SESSION_PRESENT_COOKIE_NAME}=1` } }],
    ["a locale cookie the served set no longer holds", {
      headers: { cookie: `${LOCALE_COOKIE_NAME}=${STALE_COOKIE_LOCALE}` },
    }],
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

  // With detection off next-intl negotiates nothing, so the signals below decide nothing either and
  // the visitor they used to send to the app can read the stored copy.
  describe("with locale detection off", () => {
    beforeEach(() => {
      localeDetection.enabled = false;
    });

    test("ignores a locale cookie the served set no longer holds", () => {
      expect(resolve({
        headers: { cookie: `${LOCALE_COOKIE_NAME}=${STALE_COOKIE_LOCALE}` },
      })).not.toBeNull();
    });

    test.runIf(ALTERNATE_LOCALE !== undefined)("ignores Accept-Language", () => {
      expect(resolve({
        headers: { "accept-language": `${ALTERNATE_LOCALE},${DEFAULT_LOCALE};q=0.5` },
      })).not.toBeNull();
    });

    test("still refuses a signed-in visitor", () => {
      expect(resolve({
        headers: { cookie: `${AUTH_SESSION_PRESENT_COOKIE_NAME}=1` },
      })).toBeNull();
    });
  });
});
