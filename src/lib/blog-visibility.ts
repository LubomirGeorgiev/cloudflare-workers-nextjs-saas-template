import "server-only"

import { getCmsCollectionCount } from "@/lib/cms/entry"

// Single source of truth for "does the blog have any published posts?" — drives
// the nav link's visibility and the listing/detail pages' redirect-home guards.
// Counts the default locale (`getCmsCollectionCount` defaults to it): posts are
// authored per-locale, so a locale without translations is not an empty blog and
// should render its localized empty state instead of redirecting home.
export async function hasPublishedBlogPosts(): Promise<boolean> {
  const publishedCount = await getCmsCollectionCount({
    collectionSlug: "blog",
    status: "published",
  })

  return publishedCount > 0
}
