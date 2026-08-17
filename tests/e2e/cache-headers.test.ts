import { expect, test } from "vitest";
import { fetchAppPath } from "./app-frame";
import {
  DOCS_LLMS_TXT_CACHE_CONTROL,
  DOCS_SEARCH_CACHE_CONTROL,
  SESSION_NO_STORE_CACHE_CONTROL,
} from "../../src/constants/cache-control";
import { LLMS_TXT_PATH } from "../../src/constants";
import { OG_IMAGE_CACHE_CONTROL, OG_IMAGE_CONTENT_TYPE } from "../../src/constants/og-image";
import { LOCALE_COOKIE_NAME } from "../../src/i18n/config";
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

function expectPositiveSeconds(value: string | true | undefined): void {
  expect(typeof value).toBe("string");
  expect(Number(value)).toBeGreaterThan(0);
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

// `export const revalidate` reaches the CDN through `CDN-Cache-Control`, never through
// `Cache-Control` — the browser copy stays `max-age=0, must-revalidate` so a revalidation
// is always visible to the user. Assert the shape, not the seconds, since a fork retunes them.
test.each([
  ["landing page", "/"],
  ["docs entry", SEEDED_DOCS_ENTRY_PATH],
  ["blog entry", SEEDED_BLOG_ENTRY_PATH],
  ["blog authors index", "/blog/authors"],
  ["blog index", "/blog"],
  ["paginated blog index", "/blog/2"],
])("caches the %s at the CDN with a revalidating browser copy", async (_label, path) => {
  const response = await fetchAppPath(path, { headers: PAGE_HEADERS });

  expect(response.status).toBe(200);

  const browserDirectives = getCacheDirectives(response);
  expect(browserDirectives.public).toBe(true);
  expect(browserDirectives["max-age"]).toBe("0");
  expect(browserDirectives["must-revalidate"]).toBe(true);

  const cdnDirectives = parseCacheControl(response.headers.get("cdn-cache-control"));
  expect(cdnDirectives.public).toBe(true);
  expectPositiveSeconds(cdnDirectives["max-age"]);
  expectPositiveSeconds(cdnDirectives["stale-while-revalidate"]);
});

// The blog index reads no `searchParams` — one such read opts the whole route out of the ISR
// asserted above. Any query string must therefore be ignored and the page stay cacheable.
test("ignores a query string on the blog index and stays cacheable", async () => {
  const response = await fetchAppPath("/blog?page=2", { headers: PAGE_HEADERS });

  expect(response.status).toBe(200);
  expect(getCacheDirectives(response)["no-store"]).toBeUndefined();
  expect(parseCacheControl(response.headers.get("cdn-cache-control")).public).toBe(true);
});

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
