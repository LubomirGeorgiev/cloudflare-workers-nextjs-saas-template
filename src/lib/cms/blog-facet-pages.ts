import "server-only";

import { getBlogAuthorPagePath, getBlogListPageCount, getBlogTagPagePath } from "@/lib/blog-routing";
import type { CmsCollectionListItem } from "@/lib/cms/entry";

export function getBlogFacetPageCounts(posts: CmsCollectionListItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const post of posts) {
    const paths = new Set(post.tags?.map(({ tag }) => getBlogTagPagePath(tag.slug)));
    if (post.createdByUser) {
      paths.add(getBlogAuthorPagePath(post.createdByUser));
    }
    for (const pathname of paths) {
      counts.set(pathname, (counts.get(pathname) ?? 0) + 1);
    }
  }
  return new Map(Array.from(counts, ([pathname, count]) => [pathname, getBlogListPageCount(count)]));
}
