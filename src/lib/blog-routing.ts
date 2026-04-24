import type { Route } from "next";


export function getBlogPagePath({ page }: { page: number }): Route {
  return page <= 1 ? "/blog" : `/blog/${page}`
}
