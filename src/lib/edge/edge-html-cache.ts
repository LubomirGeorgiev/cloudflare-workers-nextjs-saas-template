import "server-only";

import {
  AUTH_SESSION_PRESENT_COOKIE_NAME,
  HTML_CONTENT_TYPE,
  SITE_DOMAIN,
} from "@/constants";
import {
  EDGE_HTML_CACHE_CONTROL,
  EDGE_HTML_CACHE_ZONE_PURGED_CACHE_CONTROL,
} from "@/constants/cache-control";
import {
  EDGE_HTML_ZONE_PURGE_OUTCOME,
  type EdgeHtmlZonePurgeOutcome,
} from "@/constants/edge-html-cache";
import { STATIC_PUBLIC_ROUTES } from "@/constants/public-routes";
import {
  ENABLED_LOCALES,
  LOCALE_COOKIE_NAME,
  type Locale,
} from "@/i18n/config";
import { decideLocaleRoute } from "@/i18n/middleware";
import { BLOG_BASE_PATH } from "@/lib/blog-routing";
import { DOCS_BASE_PATH } from "@/lib/cms/docs-config";
import { mayBeStoredHtmlPage } from "@/lib/edge/edge-html-cache-prefilter";
import { isOgImagePathname } from "@/lib/og/og-paths";
import { localizedPathname } from "@/i18n/localized-pathname";
import { getBuildId } from "@/utils/build-id";
import { mapInBatches } from "@/utils/map-in-batches";

/** Key space of the stored copies. Never a route: no request ever carries this prefix. */
const EDGE_HTML_CACHE_KEY_PREFIX = "/__edge-html";

// Keyed on our own domain, not on the request's: every hostname that reaches this Worker serves the
// same page, and the purge — which runs without a request — then names the very same key.
const EDGE_HTML_CACHE_KEY_SCHEME = "https://";

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

interface EdgeHtmlPurgeResult {
  /** How many keys the local Cache API reported as deleted. */
  deletedCount: number;
  /** The zone-wide half of the purge. */
  zonePurge: EdgeHtmlZonePurgeOutcome;
}

interface EdgeHtmlCacheEntry {
  /** Synthetic key URL of this page in this locale. */
  key: string;
  locale: Locale;
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
  const cacheStorage: CacheStorage | undefined = globalThis.caches;

  return cacheStorage && isWorkersCacheStorage(cacheStorage) ? cacheStorage.default : null;
}

function isWorkersCacheStorage(
  cacheStorage: CacheStorage,
): cacheStorage is CacheStorage & { default: EdgeCache } {
  return "default" in cacheStorage;
}

// The build id is part of the key: the Cache API outlives a deploy, and a stored page names the
// previous build's hashed chunks. A new build misses by construction; the old copies expire.
function buildEdgeHtmlCacheKey(servedPathname: string): string {
  return `${EDGE_HTML_CACHE_KEY_SCHEME}${buildEdgeHtmlCachePurgePrefix(servedPathname)}`;
}

/** The key without its scheme: the form a zone purge by prefix takes. */
function buildEdgeHtmlCachePurgePrefix(servedPathname: string): string {
  return `${SITE_DOMAIN}${EDGE_HTML_CACHE_KEY_PREFIX}/${getBuildId()}${servedPathname}`;
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

  // The decision `src/proxy.ts` acts on, so a stored copy never answers a request it would redirect.
  const decision = decideLocaleRoute({
    pathname: url.pathname,
    search: url.search,
    cookieLocale: readCookie({ headers, name: LOCALE_COOKIE_NAME }),
    acceptLanguage: headers.get("accept-language"),
  });

  if (!decision || decision.type === "redirect" || !isPublicPagePathname(decision.pathname)) {
    return null;
  }

  // One key per page, the one the purge names. The proxy also serves other spellings of the same
  // URL (`//blog`, `/%62log`), and a copy stored under one of them would outlive every purge.
  if (new URL(decision.canonical, url).pathname !== url.pathname) {
    return null;
  }

  return {
    key: buildEdgeHtmlCacheKey(url.pathname),
    locale: decision.locale,
    servedPathname: url.pathname,
    storable: method === "GET",
  };
}

// Undoes what `storeEdgeHtmlPage` changed, so a hit is indistinguishable from a miss apart from the
// debug header the entry stamps.
function restoreVisitorHeaders(stored: Response): Headers {
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

  const headers = restoreVisitorHeaders(stored);

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

  headers.set("cache-tag", buildEdgeHtmlCacheTag(entry.servedPathname));
  // A stored copy answers every anonymous visitor, so a cookie one render set must never replay.
  headers.delete("set-cookie");

  const body = response.clone().body;

  // In `waitUntil`, so the zone lookup never delays the visitor.
  ctx.waitUntil((async () => {
    // The Cache API reads this header and ignores the page's own `no-store`, which is what lets the
    // visitor keep an uncacheable response while the copy is still stored.
    headers.set("cache-control", selectEdgeHtmlCacheControl({
      zonePurgeConfigured: await isZonePurgeConfiguredForStore(),
    }));
    await cache.put(entry.key, new Response(body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    }));
  })().catch((error: unknown) => {
    console.error("Edge HTML cache write failed", error);
  }));

  return response;
}

/** The long TTL needs a zone purge: without one, a purge reaches only the data center that ran it. */
export function selectEdgeHtmlCacheControl({
  zonePurgeConfigured,
}: {
  zonePurgeConfigured: boolean;
}): string {
  return zonePurgeConfigured ? EDGE_HTML_CACHE_ZONE_PURGED_CACHE_CONTROL : EDGE_HTML_CACHE_CONTROL;
}

// Lazy, so the read path that shares this module never loads the API client. A fault keeps the short TTL.
async function isZonePurgeConfiguredForStore(): Promise<boolean> {
  try {
    const { isZonePurgeConfigured } = await import("@/lib/cloudflare-api");

    return await isZonePurgeConfigured();
  } catch {
    return false;
  }
}

/**
 * Drops the stored page of every `pathname` and `subtreePathname`, in every served locale. Call it
 * before any warm fetch of the same page, or the warm re-reads the copy it was meant to replace.
 * Never throws.
 *
 * The Cache API delete is per data center, so it reaches the colo that ran the purge, and only the
 * named pages and the subtree roots: it cannot match a prefix. So a caller names every page it knows
 * under a subtree too. When the Worker holds a `CLOUDFLARE_API_TOKEN` with `Cache Purge`, the zone
 * API also purges the named pages by tag and each subtree by key prefix, in every colo. The subtree
 * `/` reaches every stored page. `EDGE_HTML_CACHE_TTL_SECONDS` bounds what neither purge reached.
 */
export async function purgeEdgeHtmlPages({
  pathnames,
  subtreePathnames = [],
}: {
  pathnames: string[];
  // Locale-free roots, like `pathnames`. Each root page is deleted too.
  subtreePathnames?: string[];
}): Promise<EdgeHtmlPurgeResult> {
  const cache = getEdgeHtmlCache();

  if (!cache) {
    return { deletedCount: 0, zonePurge: EDGE_HTML_ZONE_PURGE_OUTCOME.NONE };
  }

  const keys = new Set<string>();
  const prefixes = new Set<string>();

  for (const servedPathname of localizeForEveryLocale(subtreePathnames)) {
    keys.add(buildEdgeHtmlCacheKey(servedPathname));
    prefixes.add(buildEdgeHtmlCachePurgePrefix(servedPathname));
  }

  const prefixList = Array.from(prefixes);
  const tags = new Set<string>();

  for (const servedPathname of localizeForEveryLocale(pathnames)) {
    keys.add(buildEdgeHtmlCacheKey(servedPathname));

    // Cloudflare matches a prefix on the raw string, so a page under a subtree needs no tag.
    const purgePrefix = buildEdgeHtmlCachePurgePrefix(servedPathname);

    if (!prefixList.some((prefix) => purgePrefix.startsWith(prefix))) {
      tags.add(buildEdgeHtmlCacheTag(servedPathname));
    }
  }

  let failedDeletes = 0;
  let lastDeleteError: unknown;
  const [deleted, zonePurge] = await Promise.all([
    mapInBatches({
      items: Array.from(keys),
      batchSize: PURGE_BATCH_SIZE,
      // Own `.catch` per key: this runs after the mutation committed, so one failed delete must not
      // fail the action or stop the other keys. One log per purge, so an outage cannot flood logs.
      fn: (key) => cache.delete(key).catch((error: unknown) => {
        failedDeletes += 1;
        lastDeleteError = error;
        return false;
      }),
    }),
    purgeEdgeHtmlPagesAcrossColos({ tags: Array.from(tags), prefixes: prefixList }),
  ]);

  if (failedDeletes > 0) {
    console.error("purgeEdgeHtmlPages: edge cache deletes failed", {
      failed: failedDeletes,
      total: keys.size,
      error: lastDeleteError,
    });
  }

  return { deletedCount: deleted.filter(Boolean).length, zonePurge };
}

function localizeForEveryLocale(pathnames: string[]): Set<string> {
  const servedPathnames = new Set<string>();

  for (const pathname of pathnames) {
    for (const locale of ENABLED_LOCALES) {
      servedPathnames.add(localizedPathname({ pathname, locale }));
    }
  }

  return servedPathnames;
}

/**
 * The same pages, purged zone-wide so every data center drops them: the tags and the prefixes each
 * go in their own requests, which `src/lib/cloudflare-api.ts` chunks at Cloudflare's per-request
 * ceiling. Never throws: a refused zone purge must never fail a publish. The local delete above
 * reaches only the named pages of one colo, so the outcome goes back to the caller.
 *
 * Imported lazily, so the read path that shares this module never loads the API client.
 */
async function purgeEdgeHtmlPagesAcrossColos({
  tags,
  prefixes,
}: {
  tags: string[];
  prefixes: string[];
}): Promise<EdgeHtmlZonePurgeOutcome> {
  if (tags.length === 0 && prefixes.length === 0) {
    return EDGE_HTML_ZONE_PURGE_OUTCOME.NONE;
  }

  try {
    const { getCachePurgeConfig, purgeZoneCachePrefixes, purgeZoneCacheTags } = await import(
      "@/lib/cloudflare-api"
    );
    const config = await getCachePurgeConfig();

    if (!config) {
      return EDGE_HTML_ZONE_PURGE_OUTCOME.UNCONFIGURED;
    }

    // Own `.catch` each, so a refused tag purge does not cancel the prefix purge.
    const results = await Promise.all([
      tags.length > 0
        ? purgeZoneCacheTags({ ...config, tags }).then(() => true, (error: unknown) => {
            console.error("purgeEdgeHtmlPagesAcrossColos: zone tag purge failed", error);
            return false;
          })
        : true,
      prefixes.length > 0
        ? purgeZoneCachePrefixes({ ...config, prefixes }).then(() => true, (error: unknown) => {
            console.error("purgeEdgeHtmlPagesAcrossColos: zone prefix purge failed", error);
            return false;
          })
        : true,
    ]);

    return results.every(Boolean)
      ? EDGE_HTML_ZONE_PURGE_OUTCOME.OK
      : EDGE_HTML_ZONE_PURGE_OUTCOME.FAILED;
  } catch (error) {
    // The TTL is the backstop.
    console.error("purgeEdgeHtmlPagesAcrossColos: zone cache purge failed", error);
    return EDGE_HTML_ZONE_PURGE_OUTCOME.FAILED;
  }
}
