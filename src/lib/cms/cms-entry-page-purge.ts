import "server-only";

import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import type { CmsEntryRef } from "@/lib/cms/cms-cache-invalidation";
import { purgeMarkdownPageCache } from "@/lib/markdown-pages/purge-page-cache";

// Parent of the entry page, e.g. `/blog/launch` -> `/blog`. The listing, pagination, tag, and
// author pages that can show the entry all sit under it, and they are too many to name here.
function entryListingPath(entryPath: string): string {
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

// The one purge hook for a CMS entry mutation. `revalidatePath` reaches only the App Router cache,
// so without this the converted `.md` twins serve the pre-mutation body until their TTL expires.
// Usable from the queue consumer too, which has no App Router request scope. Never throws.
export async function purgeCmsEntryMarkdownPages({
  entries,
}: {
  entries: CmsEntryRef[];
}): Promise<void> {
  const listingPaths = new Set<string>();

  for (const entry of entries) {
    const pagePath = cmsEntryPagePath(entry);

    if (pagePath) {
      listingPaths.add(entryListingPath(pagePath));
    }
  }

  await purgeMarkdownPageCache({ pathnames: Array.from(listingPaths) });
}
