import { OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE } from "@/constants/og-image"
import type { OgImageRouteProps } from "@/lib/og/types"

// Only reached for authors without an avatar — the page prefers the avatar as `openGraph.images`.
export const alt = "Blog author"
export const size = OG_IMAGE_SIZE
export const contentType = OG_IMAGE_CONTENT_TYPE

export default async function Image({ params }: OgImageRouteProps<{ authorId: string }>) {
  const { locale, authorId } = await params

  return (await import("@/lib/og/content-og-image")).renderBlogAuthorOgImage({
    locale,
    authorRouteParam: authorId,
  })
}
