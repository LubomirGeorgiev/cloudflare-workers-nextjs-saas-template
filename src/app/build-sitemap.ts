import "server-only"
import { getCmsCollection, getEntryLocalesForSlugs } from "@/lib/cms/entry"
import { CMS_MAX_SLUGS_PER_LOOKUP, SITE_URL } from "@/constants"
import { INDEXED_DOCS_ROUTES } from "@/constants/docs-routes"
import { BLOG_LISTING_ROUTES, STATIC_PUBLIC_ROUTES } from "@/constants/public-routes"
import { DOCS_SLUG } from "@/lib/cms/docs-config"
import type { MetadataRoute } from "next"
import { CACHE_TAGS, setCacheScope } from "@/utils/cache"
import { cmsConfig, type CollectionsUnion, type CmsNavigationKey } from "@/../cms.config"
import type { DefineCmsCollection } from "@/lib/cms/cms-models"
import { getBlogPageCountsByPath } from "@/lib/cms/blog-list-artifacts"
import { BLOG_BASE_PATH } from "@/lib/blog-routing"
import { DEFAULT_LOCALE } from "@/i18n/config"
import { getValidDateOrNow } from "@/utils/cms-entry-dates"
import {
  flattenCmsNavigationTree,
  getCmsNavigationTree,
  type CmsNavigationTreeNode,
} from "@/lib/cms/cms-navigation-repository"
import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation"
import { getCmsNavigations } from "@/lib/cms/cms-navigation-config"
import { entryAlternates, localizedSitemapAlternates } from "@/app/sitemap-alternates"

type SitemapEntry = MetadataRoute.Sitemap[number]
type SitemapChangeFrequency = NonNullable<SitemapEntry["changeFrequency"]>

interface LocalizedSitemapRoute {
  pathname: string
  changeFrequency: SitemapChangeFrequency
  priority: number
}

interface NavigationPageNode {
  resolvedPath: string
  entry: NonNullable<CmsNavigationTreeNode["entry"]>
}

// Pages per blog list path, keyed by the locale-agnostic base pathname.
type BlogPageCounts = Awaited<ReturnType<typeof getBlogPageCountsByPath>>

interface EntryLocaleTarget {
  collectionSlug: CollectionsUnion
  slug: string
}

// Static/listing routes advertise every locale. CMS routes advertise only real
// translations because fallback renders use default-locale content and are `noindex`.
const BLOG_FACET_CHANGE_FREQUENCY: SitemapChangeFrequency = "weekly"
const BLOG_FACET_PRIORITY = 0.5
const CMS_ENTRY_CHANGE_FREQUENCY: SitemapChangeFrequency = "weekly"
const CMS_ENTRY_PRIORITY = 0.8
const NAVIGATION_PAGE_CHANGE_FREQUENCY: SitemapChangeFrequency = "weekly"
const NAVIGATION_PAGE_PRIORITY = 0.7

// Concatenates rather than `new URL(pathname, SITE_URL)`, matching `absoluteLocalizedUrl`: an
// absolute pathname handed to `new URL` silently replaces a base path SITE_URL carries.
function absoluteSitemapUrl(pathname: string): string {
  const siteUrl = SITE_URL.endsWith("/") ? SITE_URL.slice(0, -1) : SITE_URL
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`

  return normalized === "/" ? siteUrl : `${siteUrl}${normalized}`
}

function localizedSitemapEntry({
  pathname,
  changeFrequency,
  priority,
}: LocalizedSitemapRoute): SitemapEntry {
  return {
    url: absoluteSitemapUrl(pathname),
    lastModified: new Date(),
    changeFrequency,
    priority,
    alternates: { languages: localizedSitemapAlternates(pathname) },
  }
}

function sitemapEntryTimestamp(entry: SitemapEntry): number {
  return entry.lastModified instanceof Date ? entry.lastModified.getTime() : 0
}

async function getLocalesByEntry(
  targets: EntryLocaleTarget[]
): Promise<Map<CollectionsUnion, Map<string, string[]>>> {
  const slugsByCollection = new Map<CollectionsUnion, Set<string>>()

  targets.forEach(({ collectionSlug, slug }) => {
    const slugs = slugsByCollection.get(collectionSlug) ?? new Set<string>()
    slugs.add(slug)
    slugsByCollection.set(collectionSlug, slugs)
  })

  const localesByCollection = new Map<CollectionsUnion, Map<string, string[]>>()

  for (const [collectionSlug, slugSet] of slugsByCollection) {
    const slugs = Array.from(slugSet)
    const localesBySlug = new Map<string, string[]>()

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

// The single dedupe pass for every source — the builders below emit raw lists and never dedupe.
// When the same URL comes from more than one source the newest `lastModified` wins.
function dedupeSitemapUrls(entries: MetadataRoute.Sitemap): MetadataRoute.Sitemap {
  const uniqueUrls = new Map<string, SitemapEntry>()

  entries.forEach(entry => {
    const current = uniqueUrls.get(entry.url)

    if (!current || sitemapEntryTimestamp(current) < sitemapEntryTimestamp(entry)) {
      uniqueUrls.set(entry.url, entry)
    }
  })

  return Array.from(uniqueUrls.values())
}

// Page one of every facet stays sourced from the default locale: an author or tag with
// no default-locale posts has no unprefixed URL to advertise.
function getBlogFacetUrls(pageCounts: BlogPageCounts): MetadataRoute.Sitemap {
  const facetPaths = Object.keys(pageCounts).filter(basePath => basePath !== BLOG_BASE_PATH)

  return facetPaths.map(basePath => localizedSitemapEntry({
    pathname: basePath,
    changeFrequency: BLOG_FACET_CHANGE_FREQUENCY,
    priority: BLOG_FACET_PRIORITY,
  }))
}

function getBlogUrls(pageCounts: BlogPageCounts): MetadataRoute.Sitemap {
  const blogCollection = cmsConfig.collections.blog as DefineCmsCollection
  const hasDefaultLocalePosts = (pageCounts[BLOG_BASE_PATH] ?? 0) > 0

  if (blogCollection.includeInSitemap === false || !hasDefaultLocalePosts) {
    return []
  }

  return [
    ...BLOG_LISTING_ROUTES.map(localizedSitemapEntry),
    ...getBlogFacetUrls(pageCounts),
  ]
}

async function getCmsEntryUrls(): Promise<MetadataRoute.Sitemap> {
  const sitemapCollections = (Object.entries(cmsConfig.collections) as Array<
    [CollectionsUnion, DefineCmsCollection]
  >).filter(([__collectionSlug, collection]) =>
    collection.includeInSitemap !== false && !collection.navigationKey
  )

  const collectionEntries = await Promise.all(
    sitemapCollections.map(([collectionSlug]) => getCmsCollection({ collectionSlug }))
  )

  const entryLocalesByCollection = await getLocalesByEntry(
    sitemapCollections.flatMap(([collectionSlug], collectionIndex) =>
      (collectionEntries[collectionIndex] ?? []).map(entry => ({
        collectionSlug,
        slug: entry.slug,
      }))
    )
  )

  return sitemapCollections.flatMap(([collectionSlug, collection], collectionIndex) => {
    const previewUrl = collection.previewUrl

    if (!previewUrl) {
      return []
    }

    return (collectionEntries[collectionIndex] ?? []).map(entry => {
      const pathname = previewUrl(entry.slug)
      const locales = entryLocalesByCollection.get(collectionSlug)?.get(entry.slug) ?? []

      return {
        url: absoluteSitemapUrl(pathname),
        lastModified: getValidDateOrNow({ value: entry.updatedAt }),
        changeFrequency: CMS_ENTRY_CHANGE_FREQUENCY,
        priority: CMS_ENTRY_PRIORITY,
        alternates: { languages: entryAlternates(pathname, locales) },
      }
    })
  })
}

function collectNavigationPageNodes(nodes: CmsNavigationTreeNode[]): NavigationPageNode[] {
  return flattenCmsNavigationTree(nodes).flatMap(node =>
    node.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE && node.entry && node.resolvedPath
      ? [{ resolvedPath: node.resolvedPath, entry: node.entry }]
      : []
  )
}

async function getNavigationUrls(navigationKey: CmsNavigationKey): Promise<MetadataRoute.Sitemap> {
  const pageNodes = collectNavigationPageNodes(await getCmsNavigationTree({ navigationKey }))
  const localesByEntry = await getLocalesByEntry(
    pageNodes.map(({ entry }) => ({
      collectionSlug: entry.collection,
      slug: entry.slug,
    }))
  )

  return pageNodes.map(({ resolvedPath, entry }) => ({
    url: absoluteSitemapUrl(resolvedPath),
    lastModified: getValidDateOrNow({ value: entry.updatedAt }),
    changeFrequency: NAVIGATION_PAGE_CHANGE_FREQUENCY,
    priority: NAVIGATION_PAGE_PRIORITY,
    alternates: {
      languages: entryAlternates(
        resolvedPath,
        localesByEntry.get(entry.collection)?.get(entry.slug) ?? []
      ),
    },
  }))
}

// The agent-platform docs pages are app routes, not CMS documents, so they never appear in the
// navigation tree. They render inside the docs layout, which redirects away when that tree is
// empty — an install with no docs navigation must not advertise them.
function getAgentPlatformDocsUrls(hasDocsNavigation: boolean): MetadataRoute.Sitemap {
  if (!hasDocsNavigation) {
    return []
  }

  return INDEXED_DOCS_ROUTES.map(({ pathname, sitemapPriority }) =>
    localizedSitemapEntry({ pathname, changeFrequency: "weekly", priority: sitemapPriority })
  )
}

// Vinext statically imports metadata routes into the Worker entry, so a body left in `sitemap.ts`
// puts the CMS repositories and the Drizzle schema on every cold isolate. The cache boundary is
// this function, not the route's default export.
// fallow-ignore-next-line unused-export -- Reached by dynamic import from src/app/sitemap.ts.
export async function buildSitemap(): Promise<MetadataRoute.Sitemap> {
  "use cache: remote"
  setCacheScope({
    tags: [CACHE_TAGS.SITEMAP],
    ttl: '8 hours',
  })

  const navigations = getCmsNavigations()

  const [blogPageCounts, cmsEntryUrls, navigationUrls] = await Promise.all([
    getBlogPageCountsByPath(DEFAULT_LOCALE),
    getCmsEntryUrls(),
    Promise.all(navigations.map((navigation) => getNavigationUrls(navigation.navigationKey))),
  ])

  const docsNavigationIndex = navigations.findIndex(
    (navigation) => navigation.navigationKey === DOCS_SLUG
  )

  return dedupeSitemapUrls([
    ...STATIC_PUBLIC_ROUTES.map(localizedSitemapEntry),
    ...getAgentPlatformDocsUrls((navigationUrls[docsNavigationIndex]?.length ?? 0) > 0),
    ...getBlogUrls(blogPageCounts),
    ...cmsEntryUrls,
    ...navigationUrls.flat(),
  ])
}
