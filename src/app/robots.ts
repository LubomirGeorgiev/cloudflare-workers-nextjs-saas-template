import "server-only"
import { SITE_URL } from "@/constants"
import { ENABLED_LOCALES } from "@/i18n/config"
import { localizedPathname } from "@/utils/i18n-urls"
import type { MetadataRoute } from "next"

// Paths worth keeping out of an index, written unprefixed. Every one of these lives under
// `app/[locale]`, so each is also reachable at `/<locale>/...` and needs a rule per served locale.
const DISALLOWED_PATHS = [
  '/dashboard/',
  '/verify-email',
  // Authorization endpoints and the consent interstitial: never useful in an index.
  '/oauth/',
] as const

// `ENABLED_LOCALES`, not `LOCALES`: a de-served locale has no routes to crawl. Under the
// `as-needed` prefix the default locale yields the bare path back, so the set stays deduped.
function disallowedPathsForEveryLocale(): string[] {
  const paths = DISALLOWED_PATHS.flatMap((pathname) =>
    ENABLED_LOCALES.map((locale) => localizedPathname({ pathname, locale })),
  )

  return [...new Set(paths)]
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: disallowedPathsForEveryLocale(),
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
