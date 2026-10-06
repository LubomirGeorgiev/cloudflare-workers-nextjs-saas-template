import type { Route } from "next";

import { BLOG_POSTS_PER_PAGE } from "@/constants";
import { getAuthorRouteParam, type AuthorUrlIdentity } from "@/utils/blog-author-url";

export const BLOG_COLLECTION_SLUG = "blog" as const
export const BLOG_BASE_PATH = "/blog"
export const CMS_TAGS_PAGE_PATH = `${BLOG_BASE_PATH}/tags`
const BLOG_AUTHORS_PAGE_PATH = `${BLOG_BASE_PATH}/authors`

export function getBlogCollectionPagePath({ pathname, page }: { pathname: string; page: number }): Route {
  return page <= 1 ? pathname : `${pathname}/${page}`;
}

export function getBlogPagePath({ page }: { page: number }): Route {
  return getBlogCollectionPagePath({ pathname: BLOG_BASE_PATH, page })
}

export function getBlogTagPagePath(slug: string): string {
  return `${CMS_TAGS_PAGE_PATH}/${slug}`;
}

export function getBlogAuthorPagePath(author: AuthorUrlIdentity): string {
  return `${BLOG_AUTHORS_PAGE_PATH}/${getAuthorRouteParam(author)}`;
}

export function getBlogListPageCount(postCount: number): number {
  return Math.ceil(postCount / BLOG_POSTS_PER_PAGE);
}

/** Every numbered page of one blog list path. Page one always exists: it renders the empty state. */
export function getBlogListPagePaths({ pathname, postCount }: { pathname: string; postCount: number }): string[] {
  const pageCount = Math.max(1, getBlogListPageCount(postCount));

  return Array.from({ length: pageCount }, (__, index) =>
    getBlogCollectionPagePath({ pathname, page: index + 1 }));
}
