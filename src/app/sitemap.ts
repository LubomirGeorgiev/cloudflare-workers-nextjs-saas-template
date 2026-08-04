import type { MetadataRoute } from "next"

// Thin on purpose — see `build-sitemap.ts` for why the body may not be statically reachable.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return (await import("./build-sitemap")).buildSitemap()
}
