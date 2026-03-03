import type { Route } from "next";


export function getBlogPagePath({ page }: { page: number }): Route {
  // @ts-expect-error - page is a number
  return page <= 1 ? "/blog" : `/blog/${page}`
}
