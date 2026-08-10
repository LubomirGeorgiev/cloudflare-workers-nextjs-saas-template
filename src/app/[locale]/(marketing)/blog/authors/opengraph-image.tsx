import { OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE } from "@/constants/og-image"
import type { OgImageRouteProps } from "@/lib/og/types"

export const alt = "Blog authors"
export const size = OG_IMAGE_SIZE
export const contentType = OG_IMAGE_CONTENT_TYPE

export default async function Image({ params }: OgImageRouteProps) {
  const { locale } = await params

  return (await import("@/lib/og/translated-og-image")).renderTranslatedOgImage({
    locale,
    namespace: "Blog.Authors.meta",
    eyebrow: "authors",
  })
}
