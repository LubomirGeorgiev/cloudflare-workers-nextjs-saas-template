/* eslint-disable import/no-unused-modules */
import "server-only"
import { getCmsCollection } from "@/lib/cms/cms-repository"
import { SITE_URL } from "@/constants"
import type { MetadataRoute } from "next"
import { withKVCache } from "@/utils/with-kv-cache"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return withKVCache(async () => {
    // Get all published blog posts
    const blogPosts = await getCmsCollection({
      collectionSlug: 'blog',
      includeRelations: { tags: true, createdByUser: true },
    })

    // Get all unique tags
    const uniqueTags = new Set<string>()
    const uniqueAuthors = new Set<string>()

    blogPosts.forEach(post => {
      post.tags?.forEach(({ tag }) => uniqueTags.add(tag.slug))
      if (post.createdByUser) {
        uniqueAuthors.add(post.createdByUser.id)
      }
    })

    // Blog post URLs
    const blogPostUrls = blogPosts.map(post => {
      // Ensure we have a valid date for lastModified
      const lastModified = post.updatedAt instanceof Date && !isNaN(post.updatedAt.getTime())
        ? post.updatedAt
        : new Date()

      return {
        url: `${SITE_URL}/blog/${post.slug}`,
        lastModified,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      }
    })

    // Tag URLs
    const tagUrls = Array.from(uniqueTags).map(tagSlug => ({
      url: `${SITE_URL}/blog/tags/${tagSlug}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    }))

    // Author URLs
    const authorUrls = Array.from(uniqueAuthors).map(authorId => ({
      url: `${SITE_URL}/blog/authors/${authorId}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    }))

    // Static routes
    const staticRoutes = [
      {
        url: SITE_URL,
        lastModified: new Date(),
        changeFrequency: 'daily' as const,
        priority: 1,
      },
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

    return [...staticRoutes, ...blogPostUrls, ...tagUrls, ...authorUrls]
  }, {
    key: 'sitemap',
    ttl: '8 hours',
  })
}
