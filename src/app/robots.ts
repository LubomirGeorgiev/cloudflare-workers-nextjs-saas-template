import "server-only"
import { SITE_URL } from "@/constants"
import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/dashboard/',
          '/verify-email',
          // Authorization endpoints and the consent interstitial: never useful in an index.
          '/oauth/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
