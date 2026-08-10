import { OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE } from "@/constants/og-image"
import type { OgImageRouteProps } from "@/lib/og/types"

// Thin by contract: vinext static-imports metadata routes into the RSC route table, so anything
// reachable from here without `await import()` is evaluated on every cold isolate.
export const alt = "Blog"
export const size = OG_IMAGE_SIZE
export const contentType = OG_IMAGE_CONTENT_TYPE

export default async function Image({ params }: OgImageRouteProps) {
  const { locale } = await params

  return (await import("@/lib/og/translated-og-image")).renderTranslatedOgImage({
    locale,
    namespace: "Blog.ListPage.meta",
    eyebrow: "blog",
  })
}
