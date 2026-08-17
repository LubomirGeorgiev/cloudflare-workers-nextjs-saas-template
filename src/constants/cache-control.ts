/**
 * `Cache-Control` values that route handlers set by hand.
 *
 * Import-free on purpose: these sit on route hot paths, and `tests/e2e/cache-headers.test.ts`
 * asserts the emitted headers against these same constants so a route cannot drift from its test.
 */

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

// Short shared TTL: search hits repeat across visitors, but a new doc should surface quickly.
export const DOCS_SEARCH_CACHE_CONTROL =
  "public, s-maxage=300, stale-while-revalidate=3600";

// Session state must never sit in a shared or private cache; every directive here is deliberate.
export const SESSION_NO_STORE_CACHE_CONTROL =
  "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
