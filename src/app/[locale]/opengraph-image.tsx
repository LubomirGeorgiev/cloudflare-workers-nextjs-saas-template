import {
  OG_IMAGE_CONTENT_TYPE,
  OG_IMAGE_SIZE,
} from "@/constants/og-image"
import { SITE_NAME } from "@/constants"
import type { OgImageRouteProps } from "@/lib/og/types"

// Site-wide default inherited by every localized route without a deeper `opengraph-image.tsx`.
// Kept import-free beyond leaf constants and types: vinext static-imports metadata routes into the
// RSC route table, so anything reachable from here is evaluated on every cold isolate.
export const alt = SITE_NAME
export const size = OG_IMAGE_SIZE
export const contentType = OG_IMAGE_CONTENT_TYPE

export default async function Image({ params }: OgImageRouteProps) {
  const { locale } = await params

  return (await import("@/lib/og/translated-og-image")).renderTranslatedOgImage({
    locale,
    namespace: "Landing.meta",
  })
}
