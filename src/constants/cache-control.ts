/**
 * `Cache-Control` values that route handlers set by hand.
 *
 * These sit on route hot paths, so this module imports nothing but other import-free constants:
 * anything with a runtime dependency joins every cold isolate's startup graph. Also,
 * `tests/e2e/cache-headers.test.ts` asserts the emitted headers against these same constants, so a
 * route cannot drift from its test.
 *
 * How the edge reads these headers — Workers Caching, `Vary` variants, and purge identity — is in
 * `docs/edge-caching.md`. Read it before you change a directive here.
 */

import { CACHE_TAGS } from "@/constants/cache-tags";

// The docs tree changes only when an editor publishes, and a stale copy costs an agent nothing.
export const DOCS_LLMS_TXT_CACHE_CONTROL =
  "public, s-maxage=3600, stale-while-revalidate=86400";

// CMS Markdown changes only on publish. Keep a stale copy available while the next copy loads.
export const CMS_MARKDOWN_CACHE_CONTROL =
  "public, s-maxage=3600, stale-while-revalidate=86400";

// Page Markdown is converted from the rendered page and a CMS publish purges its KV copy, so this
// TTL is only the backstop. One value for the shared header and the KV `expirationTtl`; the stale
// window lets a shared cache serve the old copy while the next conversion runs.
export const MARKDOWN_PAGE_CACHE_TTL_SECONDS = 3600;
export const MARKDOWN_PAGE_CACHE_CONTROL =
  `public, s-maxage=${MARKDOWN_PAGE_CACHE_TTL_SECONDS}, stale-while-revalidate=86400`;

// A `no-store` 303 dropped the whole cache entry, and every `vary: accept` variant with it, so one
// agent request cold-flushed the page HTML for every visitor in that data center. Measured against
// production, not inferred — the A/B probe is in docs/edge-caching.md. Storing makes it a variant.
export const MARKDOWN_NEGOTIATION_CACHE_CONTROL =
  `public, max-age=0, s-maxage=${MARKDOWN_PAGE_CACHE_TTL_SECONDS}`;

// Short shared TTL: search hits repeat across visitors, but a new doc should surface quickly.
export const DOCS_SEARCH_CACHE_CONTROL =
  "public, s-maxage=300, stale-while-revalidate=3600";

// Session state must never sit in a shared or private cache; every directive here is deliberate.
export const SESSION_NO_STORE_CACHE_CONTROL =
  "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";

// Vinext pins every metadata route to a browser-revalidate policy, so `worker-entrypoint.ts` stamps
// the edge policy itself. `CDN-Cache-Control` form, hence `max-age` rather than `s-maxage`.
export const METADATA_ROUTE_EDGE_CACHE_CONTROL =
  "public, max-age=3600, stale-while-revalidate=86400";

// The API catalog and the OpenAPI document are prebuilt bytes that change only on deploy, and the
// edge fast path returns them before the metadata policy above can reach them, so each producer
// stamps this itself. Workers Caching partitions by Worker version, so each deploy starts cold and
// no purge is needed. A var or secret change is a new version too, so the TTL can be long.
export const STATIC_API_DOCUMENT_EDGE_CACHE_CONTROL =
  "public, max-age=604800, stale-while-revalidate=86400";

// An upload never reuses an R2 key, so the browser may keep a copy for a year. A delete purges the
// edge copy by `CACHE_TAGS.cmsMedia`; the shorter edge TTL bounds a purge that fails. No purge can
// reach a browser copy, so a deleted image stays visible to a browser that already loaded it.
const CMS_IMAGE_EDGE_TTL_SECONDS = 7 * 86_400;
export const CMS_IMAGE_CACHE_CONTROL =
  `public, max-age=31536000, s-maxage=${CMS_IMAGE_EDGE_TTL_SECONDS}, immutable`;
// The media delete warning states the window from this.
export const CMS_IMAGE_EDGE_TTL_DAYS = Math.round(CMS_IMAGE_EDGE_TTL_SECONDS / 86_400);

// The internal document is answered per credential, so no cache may keep a copy a later request
// could be served without being authorized again — not a shared one, not the browser's.
export const INTERNAL_API_DOCUMENT_CACHE_CONTROL = "no-store";

// The tag to purge each edge copy under, or `null` for content that changes on deploy alone.
export const EDGE_CACHED_METADATA_ROUTE_TAGS: Readonly<Record<string, string | null>> = {
  "/sitemap.xml": CACHE_TAGS.SITEMAP,
  "/robots.txt": null,
};

// A stored copy of a rendered public page, kept in the Cache API under a synthetic key. Without a
// zone purge, a purge reaches one data center, so other copies live this long. See "Two layers".
export const EDGE_HTML_CACHE_TTL_SECONDS = 300;

// With a zone purge, a CMS write reaches every data center. This bounds what no purge reaches: a
// failed purge, a dashboard var or secret change, and the GitHub star count (1 h data cache).
const EDGE_HTML_CACHE_ZONE_PURGED_TTL_SECONDS = 3600;

// Admin copy states the window from these, so a fork that retunes a TTL retunes the sentences too.
export const EDGE_HTML_CACHE_TTL_MINUTES = Math.round(EDGE_HTML_CACHE_TTL_SECONDS / 60);
export const EDGE_HTML_CACHE_ZONE_PURGED_TTL_MINUTES =
  Math.round(EDGE_HTML_CACHE_ZONE_PURGED_TTL_SECONDS / 60);

// Only the stored copy ever carries this. The visitor keeps the page's own `no-store` policy, so a
// signed-in visitor can never evict the copy and Workers Caching still stores no page.
export const EDGE_HTML_CACHE_CONTROL = `public, s-maxage=${EDGE_HTML_CACHE_TTL_SECONDS}`;
export const EDGE_HTML_CACHE_ZONE_PURGED_CACHE_CONTROL =
  `public, s-maxage=${EDGE_HTML_CACHE_ZONE_PURGED_TTL_SECONDS}`;

// The debug header and its values live in their own leaf, because `scripts/measure-ttfb.mjs`
// imports them as plain Node and cannot resolve the `@/` alias this module uses. Re-exported here
// so every call site keeps one import.
export { EDGE_HTML_CACHE_HEADER, EDGE_HTML_CACHE_STATUS } from "@/constants/edge-html-cache";
