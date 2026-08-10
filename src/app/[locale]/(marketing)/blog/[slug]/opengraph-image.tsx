import { OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE } from "@/constants/og-image"
import type { OgImageRouteProps } from "@/lib/og/types"

// Only reached when the post has no featured image: the page's `generateMetadata` sets
// `openGraph.images` whenever one exists, and vinext drops the file-convention route for any
// segment whose metadata already declares an `images` key.
export const alt = "Blog post"
export const size = OG_IMAGE_SIZE
export const contentType = OG_IMAGE_CONTENT_TYPE

export default async function Image({ params }: OgImageRouteProps<{ slug: string }>) {
  const { locale, slug } = await params

  return (await import("@/lib/og/content-og-image")).renderBlogPostOgImage({ locale, slug })
}
