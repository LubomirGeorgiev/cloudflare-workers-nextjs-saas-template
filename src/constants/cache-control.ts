/**
 * `Cache-Control` values that route handlers set by hand.
 *
 * These sit on route hot paths, so this module imports nothing but other import-free constants:
 * anything with a runtime dependency joins every cold isolate's startup graph. Also,
 * `tests/e2e/cache-headers.test.ts` asserts the emitted headers against these same constants, so a
 * route cannot drift from its test.
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

// The Accept-negotiated redirect from a page to its `.md` twin. Two representations share this
// URL, and Cloudflare's edge honours no `Vary` but `Accept-Encoding`, so a stored redirect would
// reach browsers. Never cache it. The redirect still sends `vary: accept` for the caches that do
// honour it; the HTML representation sends none, because on Cloudflare it would change nothing.
export const MARKDOWN_NEGOTIATION_CACHE_CONTROL = "no-store";

// Short shared TTL: search hits repeat across visitors, but a new doc should surface quickly.
export const DOCS_SEARCH_CACHE_CONTROL =
  "public, s-maxage=300, stale-while-revalidate=3600";

// Session state must never sit in a shared or private cache; every directive here is deliberate.
export const SESSION_NO_STORE_CACHE_CONTROL =
  "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";

// Metadata routes never reach the Cloudflare CDN adapter every other cacheable response goes
// through, so vinext hands them back uncacheable and `worker-entrypoint.ts` stamps the edge policy
// itself. `CDN-Cache-Control` form, hence `max-age` rather than `s-maxage`.
export const METADATA_ROUTE_EDGE_CACHE_CONTROL =
  "public, max-age=3600, stale-while-revalidate=86400";

// The API catalog and the OpenAPI document are prebuilt bytes that change only on deploy, and the
// edge fast path returns them before the metadata policy above can reach them, so each producer
// stamps this itself. No purge follows a deploy, so the TTL is the drift window: keep it an hour.
export const STATIC_API_DOCUMENT_EDGE_CACHE_CONTROL =
  "public, max-age=3600, stale-while-revalidate=86400";

// The tag to purge each edge copy under, or `null` for content that changes on deploy alone.
export const EDGE_CACHED_METADATA_ROUTE_TAGS: Readonly<Record<string, string | null>> = {
  "/sitemap.xml": CACHE_TAGS.SITEMAP,
  "/robots.txt": null,
};
