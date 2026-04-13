import "server-only"
import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { getCmsTags, getCmsCollection } from "@/lib/cms/cms-repository"
import { BlogCard } from "@/components/blog-card"
import { CmsEntryTags } from "@/components/cms-entry-tags"
import type { CollectionPage, WithContext } from "schema-dts"
import { getCmsEntryDates } from "@/utils/cms-entry-dates"

type TagPageProps = {
  params: Promise<{
    slug: string
  }>
}

export async function generateMetadata({
  params,
}: TagPageProps): Promise<Metadata> {
  const { slug } = await params
  const tags = await getCmsTags()
  const tag = tags.find(t => t.slug === slug)

  if (!tag) {
    return {
      title: "Tag Not Found",
    }
  }

  return {
    title: `${tag.name} - Blog Tags`,
    description: tag.description || `Browse blog posts tagged with ${tag.name}`,
    alternates: {
      canonical: `/blog/tags/${slug}`,
    },
    openGraph: {
      title: `${tag.name} - Blog Tags`,
      description: tag.description || `Browse blog posts tagged with ${tag.name}`,
      type: "website",
      url: `/blog/tags/${slug}`,
    },
    twitter: {
      card: "summary",
      title: `${tag.name} - Blog Tags`,
      description: tag.description || `Browse blog posts tagged with ${tag.name}`,
    },
  }
}

export default async function TagPage({ params }: TagPageProps) {
  const { slug } = await params

  // Get all tags to find the current one
  const tags = await getCmsTags()
  const tag = tags.find(t => t.slug === slug)

  if (!tag) {
    notFound()
  }

  // Get all blog entries and filter by tag
  const allBlogEntries = await getCmsCollection({
    collectionSlug: 'blog',
    includeRelations: { tags: true, createdByUser: true },
  })

  const blogEntries = allBlogEntries.filter(entry =>
    entry.tags?.some(entryTag => entryTag.tag.id === tag.id)
  )

  // JSON-LD structured data for CollectionPage
  const jsonLd: WithContext<CollectionPage> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${tag.name} - Blog Posts`,
    description: tag.description || `Browse blog posts tagged with ${tag.name}`,
    ...(blogEntries.length > 0 && {
      mainEntity: {
        "@type": "ItemList",
        itemListElement: blogEntries.map((entry, index) => {
          const { publishedDate, modifiedDate } = getCmsEntryDates({
            publishedAt: entry.publishedAt,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
          })

          return {
            "@type": "ListItem",
            position: index + 1,
            item: {
              "@type": "BlogPosting",
              headline: entry.title,
              datePublished: publishedDate.toISOString(),
              dateModified: modifiedDate.toISOString(),
            },
          }
        }),
      },
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
        <Link
          href="/blog/tags"
          className="text-sm text-muted-foreground hover:text-primary transition-all mb-4 inline-block"
        >
          ← Back to all tags
        </Link>
        <h1 className="text-4xl font-bold mb-4">{tag.name}</h1>
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <CmsEntryTags
            tags={[{ tag }]}
            maxTags={1}
          />
          <span className="text-sm text-muted-foreground">
            {blogEntries.length} {blogEntries.length === 1 ? 'post' : 'posts'}
          </span>
        </div>
        {tag.description && (
          <p className="text-xl text-muted-foreground">
            {tag.description}
          </p>
        )}
      </div>

      {blogEntries.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No blog posts found with this tag.</p>
        </div>
      ) : (
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {blogEntries.map((entry) => (
            <BlogCard key={entry.id} entry={entry} showTags={false} />
          ))}
        </div>
      )}
    </div>
    </>
  )
}
