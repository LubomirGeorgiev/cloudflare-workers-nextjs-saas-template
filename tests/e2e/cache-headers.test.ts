import { expect, test } from "vitest";
import { fetchAppPath } from "./app-frame";
import {
  DOCS_LLMS_TXT_CACHE_CONTROL,
  DOCS_SEARCH_CACHE_CONTROL,
  METADATA_ROUTE_EDGE_CACHE_CONTROL,
  SESSION_NO_STORE_CACHE_CONTROL,
} from "../../src/constants/cache-control";
import { CACHE_TAGS } from "../../src/constants/cache-tags";
import { I18N_ENABLED, LLMS_TXT_PATH } from "../../src/constants";
import { OG_IMAGE_CACHE_CONTROL, OG_IMAGE_CONTENT_TYPE } from "../../src/constants/og-image";
import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALE_COOKIE_NAME } from "../../src/i18n/config";
import { SEEDED_BLOG_ENTRY_PATH, SEEDED_DOCS_ENTRY_PATH } from "./seed-fixtures";

// A crawler or an `<img>` never asks for HTML, which is exactly how `isOgImageRequest`
// tells a generated card apart from a page whose slug looks like one.
const CRAWLER_HEADERS = { accept: "image/*" } as const;
const PAGE_HEADERS = { accept: "text/html" } as const;
const REDIRECT_HOP_LIMIT = 3;

type CacheDirectives = Record<string, string | true>;

function parseCacheControl(header: string | null): CacheDirectives {
  if (!header) {
    return {};
  }

  return Object.fromEntries(
    header
      .split(",")
      .map((directive) => directive.trim().toLowerCase())
      .filter(Boolean)
      .map((directive) => {
        const separator = directive.indexOf("=");
        return separator === -1
          ? [directive, true]
          : [directive.slice(0, separator), directive.slice(separator + 1)];
      })
  );
}

function getCacheDirectives(response: Response): CacheDirectives {
  return parseCacheControl(response.headers.get("cache-control"));
}

function getSetCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

// Directive order carries no meaning, so compare the parsed sets against the constant the
// route itself uses. A reordering stays green; a changed policy does not.
function expectCachePolicy(response: Response, policy: string): void {
  expect(getCacheDirectives(response)).toEqual(parseCacheControl(policy));
}

// A page advertises its card on the production origin, so only the pathname is portable.
// The default locale's card is advertised locale-prefixed and redirects to the bare path,
// so walk the hops and prove none of them leaks a cookie.
async function fetchOgCard(pagePath: string): Promise<{ path: string; response: Response }> {
  const pageResponse = await fetchAppPath(pagePath, { headers: PAGE_HEADERS });
  expect(pageResponse.status).toBe(200);

  const html = await pageResponse.text();
  const ogImageMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);
  expect(ogImageMatch?.[1]).toBeTruthy();

  let cardPath = new URL(ogImageMatch![1], "https://placeholder.invalid").pathname;

  for (let hop = 0; hop <= REDIRECT_HOP_LIMIT; hop++) {
    const response = await fetchAppPath(cardPath, {
      headers: CRAWLER_HEADERS,
      redirect: "manual",
    });

    expect(getSetCookies(response)).toEqual([]);

    if (response.status < 300 || response.status >= 400) {
      return { path: cardPath, response };
    }

    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    cardPath = new URL(location!, "https://placeholder.invalid").pathname;
  }

  throw new Error(`OpenGraph card for ${pagePath} kept redirecting.`);
}

test("serves generated OpenGraph cards with the shared card cache policy and no cookie", async () => {
  for (const pagePath of ["/", "/blog", SEEDED_BLOG_ENTRY_PATH]) {
    const { response } = await fetchOgCard(pagePath);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(OG_IMAGE_CONTENT_TYPE);
    expectCachePolicy(response, OG_IMAGE_CACHE_CONTROL);
    expect(getSetCookies(response)).toEqual([]);
  }
}, 60_000);

test("keeps the locale cookie on a card path that is requested as a page", async () => {
  const { path: cardPath } = await fetchOgCard("/blog");
  const response = await fetchAppPath(cardPath, { headers: PAGE_HEADERS });

  expect(response.status).toBe(200);
  expect(getSetCookies(response).join(";")).toContain(`${LOCALE_COOKIE_NAME}=`);
}, 60_000);

test("sets the locale cookie on a normal page request", async () => {
  const response = await fetchAppPath("/blog", { headers: PAGE_HEADERS });

  expect(response.status).toBe(200);
  expect(getSetCookies(response).join(";")).toContain(`${LOCALE_COOKIE_NAME}=`);
});

test("serves the root llms.txt export with its shared cache policy", async () => {
  const response = await fetchAppPath(LLMS_TXT_PATH);

  expect(response.status).toBe(200);
  expectCachePolicy(response, DOCS_LLMS_TXT_CACHE_CONTROL);
});

// Vinext pins a metadata route to the browser-revalidate policy, so without the Worker's stamp the
// edge revalidates against the origin on every crawler hit.
test.each([
  ["/sitemap.xml", CACHE_TAGS.SITEMAP],
  ["/robots.txt", null],
])("caches %s at the CDN edge", async (path, cacheTag) => {
  const response = await fetchAppPath(path);

  expect(response.status).toBe(200);
  expect(parseCacheControl(response.headers.get("cdn-cache-control"))).toEqual(
    parseCacheControl(METADATA_ROUTE_EDGE_CACHE_CONTROL)
  );
  expect(response.headers.get("cache-tag")).toBe(cacheTag);
});

test("serves docs search results with its shared cache policy", async () => {
  const response = await fetchAppPath("/api/docs/search?q=a");

  expect(response.status).toBe(200);
  expectCachePolicy(response, DOCS_SEARCH_CACHE_CONTROL);
});

test("keeps the session endpoint out of every cache", async () => {
  const response = await fetchAppPath("/api/get-session");

  expect(response.status).toBe(200);
  expectCachePolicy(response, SESSION_NO_STORE_CACHE_CONTROL);
  expect(getCacheDirectives(response)["no-store"]).toBe(true);
  expect(response.headers.get("cdn-cache-control")).toBeNull();
});

// A public page renders on every request. `src/proxy.ts` owns the locale redirect and the locale
// cookie, and a shared-cache hit would skip it, so no page may carry a `public` policy. The data
// behind the page is what KV caches — see docs/edge-caching.md.
test.each([
  ["landing page", "/"],
  ["docs entry", SEEDED_DOCS_ENTRY_PATH],
  ["blog entry", SEEDED_BLOG_ENTRY_PATH],
  ["blog index", "/blog"],
])("never marks the %s publicly cacheable", async (_label, path) => {
  const response = await fetchAppPath(path, { headers: PAGE_HEADERS });

  expect(response.status).toBe(200);

  const directives = getCacheDirectives(response);
  expect(directives.public).toBeUndefined();
  expect(directives["s-maxage"]).toBeUndefined();
  expect(response.headers.get("cdn-cache-control")).toBeNull();
});

// The behavior the policy above protects: a visitor who signals another locale is redirected to
// it on the bare path. Derived from the enabled set, so a single-locale fork skips this.
const ALTERNATE_LOCALE = ENABLED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE);

function locationPathname(response: Response): string | null {
  const location = response.headers.get("location");

  return location ? new URL(location, "https://placeholder.invalid").pathname : null;
}

test.runIf(I18N_ENABLED && ALTERNATE_LOCALE !== undefined)(
  "redirects a visitor with a matching Accept-Language to their locale",
  async () => {
    const response = await fetchAppPath("/", {
      headers: { ...PAGE_HEADERS, "accept-language": `${ALTERNATE_LOCALE},en;q=0.5` },
      redirect: "manual",
    });

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(locationPathname(response)).toBe(`/${ALTERNATE_LOCALE}`);
  }
);

test.runIf(I18N_ENABLED && ALTERNATE_LOCALE !== undefined)(
  "redirects a visitor with a locale cookie to their locale",
  async () => {
    const response = await fetchAppPath("/blog", {
      headers: { ...PAGE_HEADERS, cookie: `${LOCALE_COOKIE_NAME}=${ALTERNATE_LOCALE}` },
      redirect: "manual",
    });

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(locationPathname(response)).toBe(`/${ALTERNATE_LOCALE}/blog`);
  }
);

test.each([["/dashboard"], ["/settings"]])(
  "never marks %s publicly cacheable",
  async (path) => {
    const response = await fetchAppPath(path, {
      headers: PAGE_HEADERS,
      redirect: "manual",
    });

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(getCacheDirectives(response).public).toBeUndefined();
    expect(response.headers.get("cdn-cache-control")).toBeNull();
  }
);
