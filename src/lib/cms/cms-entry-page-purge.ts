import "server-only";

import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import type { CmsEntryRef } from "@/lib/cms/cms-cache-invalidation";
import { getCmsNavigationEntryPaths } from "@/lib/cms/cms-navigation-entry-paths";
import { purgeEdgeHtmlPages } from "@/lib/edge/edge-html-cache";
import { purgeMarkdownPageCache } from "@/lib/markdown-pages/purge-page-cache";

// Parent of the entry page, e.g. `/blog/launch` -> `/blog`. The listing, pagination, tag, and
// author pages that can show the entry all sit under it, and they are too many to name here.
export function cmsEntryListingPath(entryPath: string): string {
  const lastSlash = entryPath.lastIndexOf("/");

  return lastSlash > 0 ? entryPath.slice(0, lastSlash) : entryPath;
}

/** The public page path of an entry, or `null` when the collection publishes no page for it. */
export function cmsEntryPagePath({
  collection,
  slug,
}: {
  collection: CollectionsUnion;
  slug: string;
}): string | null {
  const collectionConfig = cmsConfig.collections[collection];
  const previewUrlBuilder = "previewUrl" in collectionConfig
    ? collectionConfig.previewUrl
    : undefined;

  return previewUrlBuilder ? previewUrlBuilder(slug) : null;
}

/**
 * Drops the stored HTML of an entry's own page and of the listing above it, in every served locale.
 *
 * Called only from `invalidateCmsEntries`, and only from inside it: that function warms the
 * entry through the edge afterwards, so a second purge later would delete the freshly warmed page.
 * A collection whose URL comes from a navigation tree rather than from `previewUrl` (docs) resolves
 * its path through `getCmsNavigationEntryPaths`. Never throws.
 */
export async function purgeCmsEntryEdgeHtmlPages({
  entries,
}: {
  entries: CmsEntryRef[];
}): Promise<void> {
  const pathnames = new Set<string>();

  for (const entry of entries) {
    const pagePath = cmsEntryPagePath(entry);

    if (pagePath) {
      pathnames.add(pagePath);
      pathnames.add(cmsEntryListingPath(pagePath));
    }
  }

  for (const navigationPath of await getCmsNavigationEntryPaths({ entries })) {
    pathnames.add(navigationPath);
  }

  await purgeEdgeHtmlPages({ pathnames: Array.from(pathnames) });
}

// Drops the KV `.md` twins under each entry's listing, plus `alsoPathnames`. Never throws. Only
// `cms-cache-invalidation.ts` calls it, before its Workers Caching purge and its warm.
export async function purgeCmsEntryMarkdownPages({
  entries,
  alsoPathnames = [],
}: {
  entries: CmsEntryRef[];
  alsoPathnames?: string[];
}): Promise<void> {
  const listingPaths = new Set<string>(alsoPathnames);

  for (const entry of entries) {
    const pagePath = cmsEntryPagePath(entry);

    if (pagePath) {
      listingPaths.add(cmsEntryListingPath(pagePath));
    }
  }

  await purgeMarkdownPageCache({ pathnames: Array.from(listingPaths) });
}
