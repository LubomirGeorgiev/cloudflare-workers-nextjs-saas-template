import type { Route } from "next";

export const BLOG_COLLECTION_SLUG = "blog" as const
export const BLOG_BASE_PATH = "/blog"
export const CMS_TAGS_PAGE_PATH = `${BLOG_BASE_PATH}/tags`

export function getBlogCollectionPagePath({ pathname, page }: { pathname: string; page: number }): Route {
  return page <= 1 ? pathname : `${pathname}/${page}`;
}

export function getBlogPagePath({ page }: { page: number }): Route {
  return getBlogCollectionPagePath({ pathname: BLOG_BASE_PATH, page })
}
