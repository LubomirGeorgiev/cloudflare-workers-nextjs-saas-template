import "server-only"
import { CMS_MAX_SLUGS_PER_LOOKUP, SITE_URL } from "@/constants"
import type { CollectionsUnion } from "@/../cms.config"
import { getEntryLocalesForSlugs } from "@/lib/cms/entry"
import { collectPublicPages, type PublicPage } from "@/lib/sitemap/public-pages"
import type { MetadataRoute } from "next"
import { CACHE_TAGS, setCacheScope } from "@/utils/cache"
import { entryAlternates, localizedSitemapAlternates } from "@/app/sitemap-alternates"

type SitemapEntry = MetadataRoute.Sitemap[number]

/** The locales that hold a real row, per collection then per slug. */
type EntryLocales = Map<CollectionsUnion, Map<string, readonly string[]>>

// Concatenates rather than `new URL(pathname, SITE_URL)`, matching `absoluteLocalizedUrl`: an
// absolute pathname handed to `new URL` silently replaces a base path SITE_URL carries.
function absoluteSitemapUrl(pathname: string): string {
  const siteUrl = SITE_URL.endsWith("/") ? SITE_URL.slice(0, -1) : SITE_URL
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`

  return normalized === "/" ? siteUrl : `${siteUrl}${normalized}`
}

// Only the sitemap needs these rows, so the lookup lives here rather than in the shared collector
// the admin edge-HTML purge also reads. One D1 read per collection, batched by the slug ceiling.
async function readEntryLocales(pages: PublicPage[]): Promise<EntryLocales> {
  const slugsByCollection = new Map<CollectionsUnion, Set<string>>()

  for (const { entry } of pages) {
    if (!entry) {
      continue
    }

    const slugs = slugsByCollection.get(entry.collectionSlug) ?? new Set<string>()
    slugs.add(entry.slug)
    slugsByCollection.set(entry.collectionSlug, slugs)
  }

  const localesByCollection: EntryLocales = new Map()

  for (const [collectionSlug, slugSet] of slugsByCollection) {
    const slugs = Array.from(slugSet)
    const localesBySlug = new Map<string, readonly string[]>()

    for (let index = 0; index < slugs.length; index += CMS_MAX_SLUGS_PER_LOOKUP) {
      const batch = await getEntryLocalesForSlugs({
        collectionSlug,
        slugs: slugs.slice(index, index + CMS_MAX_SLUGS_PER_LOOKUP),
      })

      batch.forEach((locales, slug) => localesBySlug.set(slug, Array.from(locales)))
    }

    localesByCollection.set(collectionSlug, localesBySlug)
  }

  return localesByCollection
}

// Static/listing routes advertise every locale. CMS routes advertise only real translations,
// because a fallback render uses default-locale content and is `noindex`.
function sitemapEntry({ page, entryLocales }: { page: PublicPage; entryLocales: EntryLocales }): SitemapEntry {
  const translatedLocales = page.entry
    ? entryLocales.get(page.entry.collectionSlug)?.get(page.entry.slug) ?? []
    : null

  return {
    url: absoluteSitemapUrl(page.pathname),
    lastModified: page.lastModified,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
    alternates: {
      languages: translatedLocales === null
        ? localizedSitemapAlternates(page.pathname)
        : entryAlternates(page.pathname, translatedLocales),
    },
  }
}

// Vinext statically imports metadata routes into the Worker entry, so a body left in `sitemap.ts`
// puts the CMS repositories and the Drizzle schema on every cold isolate. The cache boundary is
// this function, not the route's default export.
export async function buildSitemap(): Promise<MetadataRoute.Sitemap> {
  "use cache: remote"
  setCacheScope({
    tags: [CACHE_TAGS.SITEMAP],
    ttl: '8 hours',
  })

  const pages = await collectPublicPages()
  const entryLocales = await readEntryLocales(pages)

  return pages.map((page) => sitemapEntry({ page, entryLocales }))
}
