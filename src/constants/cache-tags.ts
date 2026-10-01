/**
 * The tags the app purges cached content under.
 *
 * No runtime imports beyond two import-free leaves: the Worker entrypoint stamps the sitemap tag on
 * a hot path, so these names cannot live in `src/utils/cache.ts`, whose `server-only`/`next/cache`/
 * `ms` imports would join every cold isolate's startup graph. `src/utils/cache.ts` re-exports
 * `CACHE_TAGS`.
 */

import { CACHE_TAG_MAX_LENGTH } from "@/constants";
import { fnv1a } from "@/utils/hash";

const CMS_PREFIX = "cms";
const HASHED_TAG_PREFIX = "h~";

// Each part is percent-encoded, so a tag never holds the comma that splits a `Cache-Tag` header,
// or the control character, `\`, or `:` that Vinext's KV data cache refuses.
function cmsTag({ kind, parts }: { kind: string; parts: string[] }): string {
  const prefix = `${CMS_PREFIX}-${kind}`;
  const tag = [prefix, ...parts.map((part) => encodeURIComponent(part))].join("-");

  // Hashed here, not at the purge, so the `Cache-Tag` header, the KV revalidation, and the purge
  // name the same tag. A collision only drops one extra entry.
  return tag.length <= CACHE_TAG_MAX_LENGTH ? tag : `${prefix}-${HASHED_TAG_PREFIX}${fnv1a(tag)}`;
}

export const CACHE_TAGS = {
  SITEMAP: "sitemap",
  CMS_TAGS: `${CMS_PREFIX}-tags`,
  cmsEntry({
    collectionSlug,
    slug,
  }: {
    collectionSlug: string;
    slug: string;
  }) {
    return cmsTag({ kind: "entry", parts: [collectionSlug, slug] });
  },
  cmsCollection(collectionSlug: string) {
    return cmsTag({ kind: "collection", parts: [collectionSlug] });
  },
  cmsCollectionCount(collectionSlug: string) {
    return cmsTag({ kind: "collection-count", parts: [collectionSlug] });
  },
  cmsNavigation(navigationKey: string) {
    return cmsTag({ kind: "navigation", parts: [navigationKey] });
  },
  cmsRedirect(navigationKey: string) {
    return cmsTag({ kind: "redirect", parts: [navigationKey] });
  },
  cmsSearchCollection(collectionSlug: string) {
    return cmsTag({ kind: "search", parts: [collectionSlug] });
  },
} as const;

/** The `Cache-Tag` header value for a response. */
export function formatCacheTagHeader(tags: readonly string[]): string {
  return Array.from(new Set(tags)).join(",");
}
