import "server-only"
import { getCmsCollection, getEntryLocales } from "@/lib/cms/entry"
import { SITE_URL } from "@/constants"
import { INDEXED_DOCS_ROUTES } from "@/constants/docs-routes"
import { DOCS_SLUG } from "@/lib/cms/docs-config"
import type { MetadataRoute } from "next"
import { CACHE_TAGS, setCacheScope } from "@/utils/cache"
import { cmsConfig, type CollectionsUnion, type CmsNavigationKey } from "@/../cms.config"
import type { DefineCmsCollection } from "@/lib/cms/cms-models"
import { getAuthorRouteParam } from "@/utils/blog-author-url"
import { getValidDateOrNow } from "@/utils/cms-entry-dates"
import { getCmsNavigationTree } from "@/lib/cms/cms-navigation-repository"
import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation"
import { getCmsNavigations } from "@/lib/cms/cms-navigation-config"
import { entryAlternates, localizedSitemapAlternates } from "@/app/sitemap-alternates"

function buildAbsoluteCmsUrl(pathname: string): string {
  return new URL(pathname, SITE_URL).toString()
}

// Deduplicate sitemap entries by URL and keep the freshest metadata when duplicates occur.
// If the same URL is produced by multiple sources, the entry with the newest lastModified wins.
function dedupeSitemapUrls(entries: MetadataRoute.Sitemap): MetadataRoute.Sitemap {
  const uniqueUrls = new Map<string, MetadataRoute.Sitemap[number]>()

  entries.forEach(entry => {
    const current = uniqueUrls.get(entry.url)
    const entryLastModified =
      entry.lastModified instanceof Date ? entry.lastModified : undefined
    const currentLastModified =
      current?.lastModified instanceof Date ? current.lastModified : undefined

    if (!current) {
      uniqueUrls.set(entry.url, entry)
      return
    }

    if (!currentLastModified || (entryLastModified && currentLastModified < entryLastModified)) {
      uniqueUrls.set(entry.url, entry)
    }
  })

  return Array.from(uniqueUrls.values())
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

  // Batched per-collection so the N `getEntryLocales` lookups for one collection's
  // entries run concurrently rather than serially; `getEntryLocales` itself is
  // `"use cache: remote"`-backed, so repeat sitemap builds hit cache rather than D1.
  const entryLocalesByCollection = await Promise.all(
    sitemapCollections.map(([collectionSlug], collectionIndex) =>
      Promise.all(
        (collectionEntries[collectionIndex] ?? []).map(entry =>
          getEntryLocales({ collectionSlug, slug: entry.slug })
        )
      )
    )
  )

  const uniqueUrls = new Map<string, MetadataRoute.Sitemap[number]>()

  sitemapCollections.forEach(([__, collection], collectionIndex) => {
    const previewUrl = collection.previewUrl
    if (!previewUrl) {
      return
    }

    collectionEntries[collectionIndex]?.forEach((entry, entryIndex) => {
      const pathname = previewUrl(entry.slug)
      const url = buildAbsoluteCmsUrl(pathname)
      const current = uniqueUrls.get(url)
      const lastModified = getValidDateOrNow({ value: entry.updatedAt })
      const currentLastModified =
        current?.lastModified instanceof Date ? current.lastModified : undefined

      if (!current || !currentLastModified || currentLastModified < lastModified) {
        const locales = entryLocalesByCollection[collectionIndex]?.[entryIndex] ?? []

        uniqueUrls.set(url, {
          url,
          lastModified,
          changeFrequency: "weekly" as const,
          priority: 0.8,
          alternates: { languages: entryAlternates(pathname, locales) },
        })
      }
    })
  })

  return Array.from(uniqueUrls.values())
}

async function getNavigationUrls(navigationKey: CmsNavigationKey): Promise<MetadataRoute.Sitemap> {
  const navigationTree = await getCmsNavigationTree({
    navigationKey,
  })

  const stack = [...navigationTree]
  const pageNodes: Array<{ resolvedPath: string; entry: NonNullable<(typeof navigationTree)[number]["entry"]> }> = []

  while (stack.length > 0) {
    const node = stack.shift()

    if (!node) {
      continue
    }

    stack.unshift(...node.children)

    if (
      node.nodeType !== CMS_NAVIGATION_NODE_TYPES.PAGE ||
      !node.entry ||
      !node.resolvedPath
    ) {
      continue
    }

    pageNodes.push({ resolvedPath: node.resolvedPath, entry: node.entry })
  }

  // Parallelized across every docs page in this navigation tree so the
  // per-entry `getEntryLocales` lookups don't serialize (same rationale as
  // `getCmsEntryUrls`); `getEntryLocales` is `"use cache: remote"`-backed.
  const entryLocalesByNode = await Promise.all(
    pageNodes.map(({ entry }) =>
      getEntryLocales({ collectionSlug: entry.collection, slug: entry.slug })
    )
  )

  return pageNodes.map(({ resolvedPath, entry }, index) => ({
    url: buildAbsoluteCmsUrl(resolvedPath),
    lastModified: getValidDateOrNow({ value: entry.updatedAt }),
    changeFrequency: "weekly" as const,
    priority: 0.7,
    alternates: { languages: entryAlternates(resolvedPath, entryLocalesByNode[index] ?? []) },
  }))
}

// The agent-platform docs pages are app routes, not CMS documents, so they never appear in the
// navigation tree. They render inside the docs layout, which redirects away when that tree is
// empty — an install with no docs navigation must not advertise them.
function getAgentPlatformDocsUrls(hasDocsNavigation: boolean): MetadataRoute.Sitemap {
  if (!hasDocsNavigation) {
    return []
  }

  return INDEXED_DOCS_ROUTES.map(({ pathname, sitemapPriority }) => ({
    url: `${SITE_URL}${pathname}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: sitemapPriority,
    alternates: { languages: localizedSitemapAlternates(pathname) },
  }))
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  "use cache: remote"
  setCacheScope({
    tags: [CACHE_TAGS.SITEMAP],
    ttl: '8 hours',
  })

  const blogCollection = cmsConfig.collections.blog as DefineCmsCollection
  const isBlogIncludedInSitemap = blogCollection.includeInSitemap !== false
  const navigations = getCmsNavigations()

  const [blogPosts, cmsEntryUrls, navigationUrls] = await Promise.all([
    getCmsCollection({
      collectionSlug: "blog",
      includeRelations: { tags: true, createdByUser: true },
    }),
    getCmsEntryUrls(),
    Promise.all(navigations.map((navigation) => getNavigationUrls(navigation.navigationKey))),
  ])

  const uniqueTags = new Set<string>()
  const uniqueAuthors = new Map<string, {
    id: string
    firstName: string | null
    lastName: string | null
    email: string | null
  }>()

  blogPosts.forEach(post => {
    post.tags?.forEach(({ tag }) => uniqueTags.add(tag.slug))
    if (post.createdByUser) {
      uniqueAuthors.set(post.createdByUser.id, {
        id: post.createdByUser.id,
        firstName: post.createdByUser.firstName,
        lastName: post.createdByUser.lastName,
        email: post.createdByUser.email,
      })
    }
  })

  // Static/listing routes advertise every locale. CMS routes advertise only real
  // translations because fallback renders use default-locale content and are `noindex`.
  const staticRoutes = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 1,
      alternates: { languages: localizedSitemapAlternates("/") },
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.3,
      alternates: { languages: localizedSitemapAlternates("/privacy") },
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.3,
      alternates: { languages: localizedSitemapAlternates("/terms") },
    },
  ]

  const blogSitemapUrls = isBlogIncludedInSitemap && blogPosts.length > 0
    ? [
      {
        url: `${SITE_URL}/blog`,
        lastModified: new Date(),
        changeFrequency: 'daily' as const,
        priority: 0.8,
        alternates: { languages: localizedSitemapAlternates("/blog") },
      },
      {
        url: `${SITE_URL}/blog/tags`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.6,
        alternates: { languages: localizedSitemapAlternates("/blog/tags") },
      },
      {
        url: `${SITE_URL}/blog/authors`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.6,
        alternates: { languages: localizedSitemapAlternates("/blog/authors") },
      },
      ...Array.from(uniqueTags).map(tagSlug => ({
        url: `${SITE_URL}/blog/tags/${tagSlug}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.5,
        alternates: { languages: localizedSitemapAlternates(`/blog/tags/${tagSlug}`) },
      })),
      ...Array.from(uniqueAuthors.values()).map(author => ({
        url: `${SITE_URL}/blog/authors/${getAuthorRouteParam(author)}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.5,
        alternates: { languages: localizedSitemapAlternates(`/blog/authors/${getAuthorRouteParam(author)}`) },
      })),
    ]
    : []

  const docsNavigationIndex = navigations.findIndex(
    (navigation) => navigation.navigationKey === DOCS_SLUG
  )

  return dedupeSitemapUrls([
    ...staticRoutes,
    ...getAgentPlatformDocsUrls((navigationUrls[docsNavigationIndex]?.length ?? 0) > 0),
    ...blogSitemapUrls,
    ...cmsEntryUrls,
    ...navigationUrls.flat(),
  ])
}
