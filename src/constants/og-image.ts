/**
 * Shared shape of every generated OpenGraph card.
 *
 * Deliberately import-free: vinext registers dynamic metadata routes as *static* imports in the
 * RSC route table (`getImportVar`, not `getLazyLoaderVar`), so every `opengraph-image.tsx` module
 * is evaluated on each cold isolate. These files may only reach this leaf and `import type`;
 * the renderer itself is behind `await import()`. See docs/worker-hot-path-and-bundle-size.md.
 */

// 1200x630 is the ratio Facebook/X/LinkedIn/Slack all crop to without letterboxing.
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const

export const OG_IMAGE_CONTENT_TYPE = "image/png"

// Rasterizing through satori + resvg costs real Worker CPU, so let the CDN absorb repeat hits.
// Not immutable: a CMS title edit has to be able to reach the card. The query string is stripped
// from the cache key first, or it would be free to enumerate — see docs/page-caching.md.
export const OG_IMAGE_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800"

// Longest strings that still fit the card's type ramp; past this the renderer truncates.
export const OG_TITLE_MAX_LENGTH = 110
export const OG_DESCRIPTION_MAX_LENGTH = 150
export const OG_EYEBROW_MAX_LENGTH = 28
export const OG_META_MAX_LENGTH = 60
