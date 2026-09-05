import type { Route } from "next";

export const BLOG_BASE_PATH = "/blog"

export function getBlogCollectionPagePath({ pathname, page }: { pathname: string; page: number }): Route {
  return (page <= 1 ? pathname : `${pathname}/${page}`) as Route;
}

export function getBlogPagePath({ page }: { page: number }): Route {
  return getBlogCollectionPagePath({ pathname: BLOG_BASE_PATH, page })
}
