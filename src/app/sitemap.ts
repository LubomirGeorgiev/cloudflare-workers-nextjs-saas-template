/* eslint-disable import/no-unused-modules */
import "server-only"
import { getCmsCollection } from "@/lib/cms/cms-repository"
import { SITE_URL } from "@/constants"
import type { MetadataRoute } from "next"
import { CACHE_KEYS, withKVCache } from "@/utils/with-kv-cache"
import { cmsConfig, type CollectionsUnion } from "@/../cms.config"
import type { DefineCmsCollection } from "@/lib/cms/cms-models"
import { getAuthorRouteParam } from "@/utils/blog-author-url"
import { getValidDateOrNow } from "@/utils/cms-entry-dates"

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
  >).filter(([, collection]) => collection.includeInSitemap !== false)

  const collectionEntries = await Promise.all(
    sitemapCollections.map(([collectionSlug]) => getCmsCollection({ collectionSlug }))
  )

  const uniqueUrls = new Map<string, MetadataRoute.Sitemap[number]>()

  sitemapCollections.forEach(([_, collection], collectionIndex) => {
    const previewUrl = collection.previewUrl
    if (!previewUrl) {
      return
    }

    collectionEntries[collectionIndex]?.forEach(entry => {
      const url = buildAbsoluteCmsUrl(previewUrl(entry.slug))
      const current = uniqueUrls.get(url)
      const lastModified = getValidDateOrNow({ value: entry.updatedAt })
      const currentLastModified =
        current?.lastModified instanceof Date ? current.lastModified : undefined

      if (!current || !currentLastModified || currentLastModified < lastModified) {
        uniqueUrls.set(url, {
          url,
          lastModified,
          changeFrequency: "weekly" as const,
          priority: 0.8,
        })
      }
    })
  })

  return Array.from(uniqueUrls.values())
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return withKVCache(async () => {
    const blogCollection = cmsConfig.collections.blog as DefineCmsCollection
    const isBlogIncludedInSitemap = blogCollection.includeInSitemap !== false

    const [blogPosts, cmsEntryUrls] = await Promise.all([
      getCmsCollection({
        collectionSlug: "blog",
        includeRelations: { tags: true, createdByUser: true },
      }),
      getCmsEntryUrls(),
    ])

    // Get all unique tags
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

    // Static routes
    const staticRoutes = [
      {
        url: SITE_URL,
        lastModified: new Date(),
        changeFrequency: 'daily' as const,
        priority: 1,
      },
      {
        url: `${SITE_URL}/privacy`,
        lastModified: new Date(),
        changeFrequency: 'monthly' as const,
        priority: 0.3,
      },
      {
        url: `${SITE_URL}/terms`,
        lastModified: new Date(),
        changeFrequency: 'monthly' as const,
        priority: 0.3,
      },
    ]

    const blogSitemapUrls = isBlogIncludedInSitemap
      ? [
        {
          url: `${SITE_URL}/blog`,
          lastModified: new Date(),
          changeFrequency: 'daily' as const,
          priority: 0.8,
        },
        {
          url: `${SITE_URL}/blog/tags`,
          lastModified: new Date(),
          changeFrequency: 'weekly' as const,
          priority: 0.6,
        },
        {
          url: `${SITE_URL}/blog/authors`,
          lastModified: new Date(),
          changeFrequency: 'weekly' as const,
          priority: 0.6,
        },
        ...Array.from(uniqueTags).map(tagSlug => ({
          url: `${SITE_URL}/blog/tags/${tagSlug}`,
          lastModified: new Date(),
          changeFrequency: 'weekly' as const,
          priority: 0.5,
        })),
        ...Array.from(uniqueAuthors.values()).map(author => ({
          url: `${SITE_URL}/blog/authors/${getAuthorRouteParam(author)}`,
          lastModified: new Date(),
          changeFrequency: 'weekly' as const,
          priority: 0.5,
        })),
      ]
      : []

    return dedupeSitemapUrls([...staticRoutes, ...blogSitemapUrls, ...cmsEntryUrls])
  }, {
    key: CACHE_KEYS.SITEMAP,
    ttl: '8 hours',
  })
}
