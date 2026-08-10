import { OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE } from "@/constants/og-image"
import type { OgImageRouteProps } from "@/lib/og/types"

// Ancestor of `docs/api`, `docs/authentication`, `docs/mcp` and `docs/[[...slug]]` — each overrides
// this with its own card; this one answers for any docs route that does not.
export const alt = "Documentation"
export const size = OG_IMAGE_SIZE
export const contentType = OG_IMAGE_CONTENT_TYPE

export default async function Image({ params }: OgImageRouteProps) {
  const { locale } = await params

  return (await import("@/lib/og/translated-og-image")).renderTranslatedOgImage({
    locale,
    namespace: "Client.Docs.meta",
    eyebrow: "docs",
  })
}
