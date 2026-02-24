import "server-only"
import { SITE_URL } from "@/constants"
import type { MetadataRoute } from "next"

// eslint-disable-next-line import/no-unused-modules
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/dashboard/',
          '/verify-email',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
