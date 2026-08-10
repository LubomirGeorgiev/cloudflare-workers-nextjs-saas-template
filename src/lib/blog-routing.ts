import type { Route } from "next";

const BLOG_BASE_PATH = "/blog"

export function getBlogPagePath({ page }: { page: number }): Route {
  return (page <= 1 ? BLOG_BASE_PATH : `${BLOG_BASE_PATH}/${page}`) as Route
}
