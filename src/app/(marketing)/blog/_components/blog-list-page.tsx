import "server-only"
import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import type { Blog, WithContext } from "schema-dts"
import { getCmsCollection, getCmsCollectionCount } from "@/lib/cms/cms-repository"
import { BlogCard } from "@/components/blog-card"
import { BlogPaginationServer } from "@/components/blog-pagination-server"
import { BLOG_POSTS_PER_PAGE } from "@/constants"
import { getBlogPagePath } from "@/lib/blog-routing"
import { getCmsEntryDates } from "@/utils/cms-entry-dates"

interface BlogListPageProps {
  page: number;
}

export function getBlogListPageMetadata({ page }: { page: number }): Metadata {
  const isFirstPage = page === 1
  const title = isFirstPage ? "Blog" : `Blog - Page ${page}`
  const description = "Read our latest articles and updates"
  const pagePath = getBlogPagePath({ page })

  return {
    title,
    description,
    alternates: {
      canonical: pagePath,
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: pagePath,
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  }
}

export async function BlogListPage({ page }: BlogListPageProps) {
  const offset = (page - 1) * BLOG_POSTS_PER_PAGE

  const [blogEntries, totalCount] = await Promise.all([
    getCmsCollection({
      collectionSlug: 'blog',
      includeRelations: { tags: true, createdByUser: true },
      limit: BLOG_POSTS_PER_PAGE,
      offset,
    }),
    getCmsCollectionCount({
      collectionSlug: 'blog',
      status: 'published',
    }),
  ])

  const totalPages = Math.ceil(totalCount / BLOG_POSTS_PER_PAGE)

  if (page < 1 || (page > 1 && (totalCount === 0 || page > totalPages))) {
    notFound()
  }

  // JSON-LD structured data for Blog
  const jsonLd: WithContext<Blog> = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "Blog",
    description: "Read our latest articles and updates",
    ...(blogEntries.length > 0 && {
      blogPost: blogEntries.map((entry) => {
        const authorName = entry.createdByUser
          ? [entry.createdByUser.firstName, entry.createdByUser.lastName].filter(Boolean).join(' ') || entry.createdByUser.email || undefined
          : undefined

        const { publishedDate, modifiedDate } = getCmsEntryDates({
          publishedAt: entry.publishedAt,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        })

        return {
          "@type": "BlogPosting" as const,
          headline: entry.title,
          datePublished: publishedDate.toISOString(),
          dateModified: modifiedDate.toISOString(),
          ...(entry.featuredImageUrl && {
            image: entry.featuredImageUrl,
          }),
          ...(authorName && {
            author: {
              "@type": "Person" as const,
              name: authorName,
            },
          }),
        }
      }),
    }),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="container mx-auto py-12">
        <div className="mb-12">
          <h1 className="text-4xl font-bold mb-4">Blog</h1>
          <p className="text-xl text-muted-foreground mb-6">
            Read our latest articles and updates
          </p>

          {/* Navigation links */}
          <div className="flex gap-4">
            <Link
              href="/blog/tags"
              className="text-sm text-muted-foreground hover:text-primary transition-all underline"
            >
              Browse by Tags
            </Link>
            <span className="text-muted-foreground">•</span>
            <Link
              href="/blog/authors"
              className="text-sm text-muted-foreground hover:text-primary transition-all underline"
            >
              Browse by Authors
            </Link>
          </div>
        </div>

        {blogEntries.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No blog posts published yet.</p>
          </div>
        ) : (
          <>
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {blogEntries.map((entry) => (
                <BlogCard key={entry.id} entry={entry} />
              ))}
            </div>

            <div className="mt-12">
              <BlogPaginationServer
                currentPage={page}
                totalPages={totalPages}
              />
            </div>
          </>
        )}
      </div>
    </>
  )
}
