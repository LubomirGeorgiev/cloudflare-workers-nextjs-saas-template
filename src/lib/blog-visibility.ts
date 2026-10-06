import "server-only"

import { BLOG_COLLECTION_SLUG } from "@/lib/blog-routing"
import { CMS_ENTRY_STATUS } from "@/app/enums"
// Straight from `queries`, never the `@/lib/cms/entry` barrel: the barrel also pulls in
// `mutations`, which imports the invalidation path that reads `getFreshPublishedBlogPostCount`.
import { getCmsCollectionCount, getFreshCmsCollectionCount } from "@/lib/cms/entry/queries"

// The one predicate behind "does the blog have published posts?". Counts the default locale (the
// count defaults to it): posts are authored per-locale, so a locale without translations is not an
// empty blog and should render its localized empty state instead of redirecting home.
const PUBLISHED_BLOG_POSTS = {
  collectionSlug: BLOG_COLLECTION_SLUG,
  status: CMS_ENTRY_STATUS.PUBLISHED,
} as const

// Drives the nav link's visibility and the listing/detail pages' redirect-home guards.
export async function hasPublishedBlogPosts(): Promise<boolean> {
  return (await getCmsCollectionCount(PUBLISHED_BLOG_POSTS)) > 0
}

// The same count straight from D1, for the invalidation that decides whether the header link flipped.
export function getFreshPublishedBlogPostCount(): Promise<number> {
  return getFreshCmsCollectionCount(PUBLISHED_BLOG_POSTS)
}
