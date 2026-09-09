import "server-only";

import {
  AUTH_SESSION_PRESENT_COOKIE_NAME,
  HTML_CONTENT_TYPE,
  SITE_DOMAIN,
  ZONE_PURGE_TAGS_PER_REQUEST,
} from "@/constants";
import { EDGE_HTML_CACHE_CONTROL } from "@/constants/cache-control";
import { STATIC_PUBLIC_ROUTES } from "@/constants/public-routes";
import { resolveLocaleAsProxyWould } from "@/i18n/accept-language";
import {
  ENABLED_LOCALES,
  LOCALE_COOKIE_NAME,
  type Locale,
} from "@/i18n/config";
import { buildLocaleCookieValue } from "@/i18n/locale-cookie";
import { splitLocalePrefix } from "@/i18n/locale-prefix";
import { routing } from "@/i18n/routing";
import { BLOG_BASE_PATH } from "@/lib/blog-routing";
import { DOCS_BASE_PATH } from "@/lib/cms/docs-config";
import { mayBeStoredHtmlPage } from "@/lib/edge/edge-html-cache-prefilter";
import { isOgImagePathname } from "@/lib/og/og-paths";
import { localizedPathname } from "@/utils/i18n-urls";
import { getBuildId } from "@/utils/build-id";
import { mapInBatches } from "@/utils/map-in-batches";

/** Key space of the stored copies. Never a route: no request ever carries this prefix. */
const EDGE_HTML_CACHE_KEY_PREFIX = "/__edge-html";

// Keyed on our own domain, not on the request's: every hostname that reaches this Worker serves the
// same page, and the purge — which runs without a request — then names the very same key.
const EDGE_HTML_CACHE_KEY_ORIGIN = `https://${SITE_DOMAIN}`;

// The visitor's own policy, parked while the stored copy carries the one the Cache API reads. A hit
// puts it back, so a hit and a miss leave with the same `cache-control`.
const PARKED_CACHE_CONTROL_HEADER = "x-edge-html-cache-original";

// A client-side navigation asks the same URL for a flight payload rather than a document, and
// Vinext varies its answer on these. A stored page must never answer one.
const ROUTER_REQUEST_HEADERS = [
  "rsc",
  "next-url",
  "next-router-prefetch",
  "next-router-state-tree",
];

/** Section roots whose whole subtree is public: the blog and docs entry, listing, and facet pages. */
const PUBLIC_PAGE_BASE_PATHS = [BLOG_BASE_PATH, DOCS_BASE_PATH];

const PUBLIC_PAGE_PATHNAMES: ReadonlySet<string> = new Set(
  STATIC_PUBLIC_ROUTES.map(({ pathname }) => pathname),
);

/** One purge names every served locale of every affected page, so the deletes stay bounded. */
const PURGE_BATCH_SIZE = 10;

// Cloudflare cannot purge a URL that uses a custom cache key, and this key is one, so the stored
// copy carries a tag per page instead. Commas separate tags in the header, so they are stripped.
const EDGE_HTML_CACHE_TAG_PREFIX = "edge-html";

// Above one API request the zone purge is skipped: a CMS mutation names a handful of paths, so a
// longer list is the admin sweep, and that panel offers `purge_everything` as its own action.
const MAX_ZONE_PURGE_TAGS = ZONE_PURGE_TAGS_PER_REQUEST;

interface EdgeHtmlCacheEntry {
  /** Synthetic key URL of this page in this locale. */
  key: string;
  locale: Locale;
  /** The `Set-Cookie` a hit adds back, or `null` when `src/proxy.ts` would not have written one. */
  localeCookie: string | null;
  /** The path this page is served at, locale prefix included. Builds the purge tag. */
  servedPathname: string;
  /** A HEAD answer carries no body, so only a GET may write the copy back. */
  storable: boolean;
}

/** `lib.dom` declares its own `caches` global, and that `CacheStorage` type carries no `default`. */
interface EdgeCache {
  delete(request: string): Promise<boolean>;
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
}

// Absent outside the Workers runtime (unit tests, tooling). Every caller then does nothing, which
// behaves exactly like a cold cache.
function getEdgeHtmlCache(): EdgeCache | null {
  const cacheStorage = globalThis.caches as unknown as { default?: EdgeCache } | undefined;

  return cacheStorage?.default ?? null;
}

// The build id is part of the key: the Cache API outlives a deploy, and a stored page names the
// previous build's hashed chunks. A new build misses by construction; the old copies expire.
function buildEdgeHtmlCacheKey(servedPathname: string): string {
  return `${EDGE_HTML_CACHE_KEY_ORIGIN}${EDGE_HTML_CACHE_KEY_PREFIX}/${getBuildId()}${servedPathname}`;
}

/** The purge handle for one stored page. Same input as the key, so the two can never disagree. */
function buildEdgeHtmlCacheTag(servedPathname: string): string {
  return `${EDGE_HTML_CACHE_TAG_PREFIX}:${getBuildId()}:${servedPathname}`.replaceAll(",", "");
}

// Hand-rolled on purpose: the only cookie parsers here are Hono's, and this module answers the
// warm read path, so it must not drag the API framework in for two lookups per request.
function readCookie({ headers, name }: { headers: Headers; name: string }): string | null {
  const cookie = headers.get("cookie");

  if (!cookie) {
    return null;
  }

  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");

    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }

  return null;
}

function isPublicPagePathname(pathname: string): boolean {
  // A card and its page share a URL and differ only by `Accept`, which this key does not name.
  if (isOgImagePathname(pathname)) {
    return false;
  }

  if (PUBLIC_PAGE_PATHNAMES.has(pathname)) {
    return true;
  }

  return PUBLIC_PAGE_BASE_PATHS.some(
    (basePath) => pathname === basePath || pathname.startsWith(`${basePath}/`),
  );
}

// Deliberately a substring test, broader than the real negotiation: any mention of another served
// locale hands the decision back to `src/proxy.ts`, which is the only place allowed to make it.
function acceptLanguageNamesAnotherLocale({
  headers,
  locale,
}: {
  headers: Headers;
  locale: Locale;
}): boolean {
  const acceptLanguage = headers.get("accept-language")?.toLowerCase();

  if (!acceptLanguage) {
    return false;
  }

  return ENABLED_LOCALES.some(
    (candidate) => candidate !== locale && acceptLanguage.includes(candidate),
  );
}

/**
 * True when next-intl must resolve this request to `locale`, so a stored copy can never reach a
 * visitor the proxy would have redirected. Mirrors `resolveLocale`'s priority: the path prefix
 * decides on its own, then the locale cookie, then `Accept-Language`.
 */
function resolvesToLocale({
  hasLocalePrefix,
  headers,
  locale,
}: {
  hasLocalePrefix: boolean;
  headers: Headers;
  locale: Locale;
}): boolean {
  if (hasLocalePrefix) {
    return true;
  }

  // With detection off next-intl negotiates nothing, so neither a stale cookie nor a foreign
  // `Accept-Language` can move this request off the served locale.
  if (!routing.localeDetection) {
    return true;
  }

  const cookieLocale = readCookie({ headers, name: LOCALE_COOKIE_NAME });

  if (cookieLocale !== null) {
    return cookieLocale === locale;
  }

  return !acceptLanguageNamesAnotherLocale({ headers, locale });
}

// Mirrors next-intl's `syncCookie`, which a hit never reaches: only a document request gets the
// cookie, and only when it carries none or carries another locale. A request with no usable
// `Accept-Language` negotiates nothing, so it gets the cookie too — the proxy does the same.
function proxyWouldSetLocaleCookie({
  headers,
  locale,
}: {
  headers: Headers;
  locale: Locale;
}): boolean {
  const secFetchDest = headers.get("sec-fetch-dest");

  if (secFetchDest !== null && secFetchDest !== "document") {
    return false;
  }

  const cookieLocale = readCookie({ headers, name: LOCALE_COOKIE_NAME });

  if (cookieLocale !== null) {
    return cookieLocale !== locale;
  }

  return resolveLocaleAsProxyWould(headers.get("accept-language")) !== locale;
}

/**
 * The stored copy this request may read and write, or `null` when it must reach the app.
 *
 * Decided from the URL and the request headers alone. Call it after the Markdown branch of
 * `worker-entrypoint.ts`: an `Accept: text/markdown` request has already been answered there.
 */
export function resolveEdgeHtmlCacheEntry({
  headers,
  method,
  url,
}: {
  headers: Headers;
  method: string;
  url: URL;
}): EdgeHtmlCacheEntry | null {
  // First, so the entrypoint's prefilter can never be narrower than this gate.
  if (!mayBeStoredHtmlPage({ headers, method, url })) {
    return null;
  }

  if (ROUTER_REQUEST_HEADERS.some((header) => headers.has(header))) {
    return null;
  }

  // The one signal that a page renders signed-in chrome. Never store or serve one of those.
  if (readCookie({ headers, name: AUTH_SESSION_PRESENT_COOKIE_NAME }) !== null) {
    return null;
  }

  const { locale, pathname: pagePathname } = splitLocalePrefix(url.pathname);

  if (!isPublicPagePathname(pagePathname)) {
    return null;
  }

  // The canonical URL of this page in this locale. Under `as-needed` routing `/en/blog` is not it:
  // next-intl answers that with a redirect, and that decision must keep running in the Worker.
  if (localizedPathname({ pathname: pagePathname, locale }) !== url.pathname) {
    return null;
  }

  if (!resolvesToLocale({ hasLocalePrefix: url.pathname !== pagePathname, headers, locale })) {
    return null;
  }

  return {
    key: buildEdgeHtmlCacheKey(url.pathname),
    locale,
    localeCookie: proxyWouldSetLocaleCookie({ headers, locale })
      ? buildLocaleCookieValue(locale)
      : null,
    servedPathname: url.pathname,
    storable: method === "GET",
  };
}

// Undoes what `storeEdgeHtmlPage` changed, so a hit is indistinguishable from a miss apart from the
// debug header the entry stamps. The locale cookie is re-added here because a hit never reaches
// `src/proxy.ts`, which is what sets it on a miss — and only when the proxy would have.
function restoreVisitorHeaders({
  localeCookie,
  stored,
}: {
  localeCookie: string | null;
  stored: Response;
}): Headers {
  const headers = new Headers(stored.headers);
  const parked = headers.get(PARKED_CACHE_CONTROL_HEADER);

  headers.delete(PARKED_CACHE_CONTROL_HEADER);
  headers.delete("age");
  headers.delete("cache-tag");

  if (parked) {
    headers.set("cache-control", parked);
  } else {
    headers.delete("cache-control");
  }

  if (localeCookie) {
    headers.append("set-cookie", localeCookie);
  }

  return headers;
}

/** The stored page for this entry, or `null` on a miss. */
export async function readEdgeHtmlPage({
  entry,
  method,
}: {
  entry: EdgeHtmlCacheEntry;
  method: string;
}): Promise<Response | null> {
  const cache = getEdgeHtmlCache();

  if (!cache) {
    return null;
  }

  const stored = await cache.match(entry.key);

  if (!stored) {
    return null;
  }

  const headers = restoreVisitorHeaders({ localeCookie: entry.localeCookie, stored });

  if (method === "HEAD") {
    void stored.body?.cancel();

    return new Response(null, { headers, status: stored.status, statusText: stored.statusText });
  }

  return new Response(stored.body, {
    headers,
    status: stored.status,
    statusText: stored.statusText,
  });
}

function isStorableHtmlPage(response: Response): boolean {
  return (
    response.status === 200 &&
    (response.headers.get("content-type") ?? "").startsWith(HTML_CONTENT_TYPE)
  );
}

/**
 * Writes the fully post-processed page back under its synthetic key and returns the visitor's copy
 * untouched. The body streams (Suspense), so the copy is written through `waitUntil` and the
 * visitor never waits on it.
 */
export function storeEdgeHtmlPage({
  ctx,
  entry,
  response,
}: {
  ctx: ExecutionContext;
  entry: EdgeHtmlCacheEntry;
  response: Response;
}): Response {
  const cache = getEdgeHtmlCache();

  if (!cache || !entry.storable || !isStorableHtmlPage(response)) {
    return response;
  }

  const headers = new Headers(response.headers);
  const visitorCacheControl = headers.get("cache-control");

  if (visitorCacheControl) {
    headers.set(PARKED_CACHE_CONTROL_HEADER, visitorCacheControl);
  }

  // The Cache API reads this header and ignores the page's own `no-store`, which is what lets the
  // visitor keep an uncacheable response while the copy is still stored.
  headers.set("cache-control", EDGE_HTML_CACHE_CONTROL);
  headers.set("cache-tag", buildEdgeHtmlCacheTag(entry.servedPathname));
  headers.delete("set-cookie");

  const copy = new Response(response.clone().body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });

  ctx.waitUntil(cache.put(entry.key, copy).catch(() => undefined));

  return response;
}

/**
 * Drops the stored page of every `pathname`, in every served locale, and returns how many keys the
 * Cache API reported as deleted. Call it before any warm fetch of the same page, or the warm
 * re-reads the copy it was meant to replace. Never throws.
 *
 * The Cache API delete is per data center, so it reaches the colo that ran the purge. When the
 * Worker holds a `CLOUDFLARE_API_TOKEN` with `Cache Purge`, the same keys are also purged through
 * the zone API, which reaches every other colo. `EDGE_HTML_CACHE_TTL_SECONDS` bounds whatever the
 * zone purge could not do.
 */
export async function purgeEdgeHtmlPages({
  pathnames,
}: {
  pathnames: string[];
}): Promise<number> {
  const cache = getEdgeHtmlCache();

  if (!cache) {
    return 0;
  }

  const keys = new Set<string>();
  const tags = new Set<string>();

  for (const pathname of pathnames) {
    for (const locale of ENABLED_LOCALES) {
      const servedPathname = localizedPathname({ pathname, locale });

      keys.add(buildEdgeHtmlCacheKey(servedPathname));
      tags.add(buildEdgeHtmlCacheTag(servedPathname));
    }
  }

  const [deleted] = await Promise.all([
    mapInBatches({
      items: Array.from(keys),
      batchSize: PURGE_BATCH_SIZE,
      // Own `.catch` per key: this runs after the mutation committed, so one failed delete must not
      // fail the action or stop the other keys.
      fn: (key) => cache.delete(key).catch(() => false),
    }),
    purgeEdgeHtmlPagesAcrossColos(Array.from(tags)),
  ]);

  return deleted.filter(Boolean).length;
}

/**
 * The same pages, purged zone-wide by tag so every data center drops them. Best effort and silent:
 * the local delete above already covers the colo that ran the mutation, and an unconfigured token
 * or a rate-limited zone must never fail a publish.
 *
 * Imported lazily, so the read path that shares this module never loads the API client.
 */
async function purgeEdgeHtmlPagesAcrossColos(tags: string[]): Promise<void> {
  if (tags.length === 0 || tags.length > MAX_ZONE_PURGE_TAGS) {
    return;
  }

  try {
    const { getCachePurgeConfig, purgeZoneCacheTags } = await import("@/lib/cloudflare-api");
    const config = await getCachePurgeConfig();

    if (config) {
      await purgeZoneCacheTags({ ...config, tags });
    }
  } catch {
    // The TTL is the backstop.
  }
}
