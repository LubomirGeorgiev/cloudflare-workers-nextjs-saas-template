import "server-only";

import { BLOG_POSTS_PER_PAGE } from "@/constants";
import type { CmsCollectionListItem } from "@/lib/cms/entry";
import { getAuthorRouteParam } from "@/utils/blog-author-url";

export function getBlogFacetPageCounts(posts: CmsCollectionListItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const post of posts) {
    const paths = new Set(post.tags?.map(({ tag }) => `/blog/tags/${tag.slug}`));
    if (post.createdByUser) {
      paths.add(`/blog/authors/${getAuthorRouteParam(post.createdByUser)}`);
    }
    for (const pathname of paths) {
      counts.set(pathname, (counts.get(pathname) ?? 0) + 1);
    }
  }
  return new Map(Array.from(counts, ([pathname, count]) => [pathname, Math.ceil(count / BLOG_POSTS_PER_PAGE)]));
}
