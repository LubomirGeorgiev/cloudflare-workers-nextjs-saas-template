import { notFound } from "next/navigation"
import Link from "next/link"
import { formatDate } from "@/utils/format-date"
import type { Metadata } from "next"
import { getCmsEntryBySlug } from "@/lib/cms/cms-repository"
import { CmsContentRenderer } from "@/components/cms-content-renderer"
import { generateMetaDescription } from "@/lib/cms/extract-text-from-content"
import type { JSONContent } from "@tiptap/core"
import Image from "next/image"
import { SITE_URL } from "@/constants"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getInitials } from "@/utils/name-initials"
import { CmsEntryTags } from "@/components/cms-entry-tags"
import type { BlogPosting, BreadcrumbList, WithContext } from "schema-dts"

type BlogPostPageProps = {
  params: Promise<{
    slug: string
  }>
}

export async function generateMetadata({
  params,
}: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params

  const entry = await getCmsEntryBySlug({
    collectionSlug: 'blog',
    slug,
  })

  if (!entry) {
    return {
      title: "Blog Post Not Found",
    }
  }

  // Get entry with relations for full metadata
  const fullEntry = await getCmsEntryBySlug({
    collectionSlug: 'blog',
    slug,
    includeRelations: { tags: true, createdByUser: true },
  })

  const description = entry.seoDescription || generateMetaDescription(entry.content as JSONContent)
  const featuredImageUrl = entry.featuredImageUrl ? `${SITE_URL}${entry.featuredImageUrl}` : undefined
  const author = fullEntry?.createdByUser
  const authorName = author
    ? [author.firstName, author.lastName].filter(Boolean).join(' ') || author.email
    : undefined
  const tags = fullEntry?.tags?.map(({ tag }) => tag.name) || []

  // Safely handle dates for OpenGraph metadata
  const publishedDate = entry.publishedAt && entry.publishedAt instanceof Date && !isNaN(entry.publishedAt.getTime())
    ? entry.publishedAt
    : entry.createdAt instanceof Date && !isNaN(entry.createdAt.getTime())
      ? entry.createdAt
      : new Date()

  const modifiedDate = entry.updatedAt instanceof Date && !isNaN(entry.updatedAt.getTime())
    ? entry.updatedAt
    : publishedDate

  return {
    title: entry.title,
    description: description || entry.title,
    alternates: {
      canonical: `/blog/${slug}`,
    },
    openGraph: {
      title: entry.title,
      description: description || entry.title,
      type: 'article',
      url: `/blog/${slug}`,
      publishedTime: publishedDate.toISOString(),
      modifiedTime: modifiedDate.toISOString(),
      ...(authorName && { authors: [authorName] }),
      ...(tags.length > 0 && { tags }),
      ...(featuredImageUrl && {
        images: [
          {
            url: featuredImageUrl,
            width: entry.featuredImage?.width || 1200,
            height: entry.featuredImage?.height || 630,
            alt: entry.featuredImage?.alt || entry.title,
          },
        ],
      }),
    },
    twitter: {
      card: 'summary_large_image',
      title: entry.title,
      description: description || entry.title,
      ...(featuredImageUrl && {
        images: [featuredImageUrl],
      }),
    },
  }
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params

  const entry = await getCmsEntryBySlug({
    collectionSlug: 'blog',
    slug,
    includeRelations: { tags: true, createdByUser: true },
  })

  if (!entry) {
    notFound()
  }

  const author = entry.createdByUser
  const authorName = author
    ? [author.firstName, author.lastName].filter(Boolean).join(' ') || author.email || 'Unknown Author'
    : 'Unknown Author'

  // Safely handle dates - ensure they're valid Date objects
  const publishedDate = entry.publishedAt && entry.publishedAt instanceof Date && !isNaN(entry.publishedAt.getTime())
    ? entry.publishedAt
    : entry.createdAt instanceof Date && !isNaN(entry.createdAt.getTime())
      ? entry.createdAt
      : new Date()

  const modifiedDate = entry.updatedAt instanceof Date && !isNaN(entry.updatedAt.getTime())
    ? entry.updatedAt
    : publishedDate

  // JSON-LD structured data for Article
  const jsonLd: WithContext<BlogPosting> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: entry.title,
    description: entry.seoDescription || generateMetaDescription(entry.content as JSONContent),
    url: `${SITE_URL}/blog/${entry.slug}`,
    datePublished: publishedDate.toISOString(),
    dateModified: modifiedDate.toISOString(),
    ...(entry.featuredImageUrl && {
      image: `${SITE_URL}${entry.featuredImageUrl}`,
    }),
    ...(author && {
      author: {
        "@type": "Person",
        name: authorName,
        url: `${SITE_URL}/blog/authors/${author.id}`,
        ...(author.avatar && {
          image: `${SITE_URL}${author.avatar}`,
        }),
      },
    }),
    ...(entry.tags && entry.tags.length > 0 && {
      keywords: entry.tags.map(({ tag }) => tag.name).join(", "),
    }),
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${SITE_URL}/blog/${entry.slug}`,
    },
    publisher: {
      "@type": "Organization",
      name: "SaaS Template",
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/favicon.ico`,
      },
    },
  }

  // Breadcrumb structured data
  const breadcrumbJsonLd: WithContext<BreadcrumbList> = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: SITE_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Blog",
        item: `${SITE_URL}/blog`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: entry.title,
        item: `${SITE_URL}/blog/${entry.slug}`,
      },
    ],
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <div className="container mx-auto py-12">
        <article className="max-w-3xl mx-auto">
          <header className="mb-8">
            <Link
              href="/blog"
              className="text-sm text-muted-foreground hover:text-primary transition-all mb-4 inline-block"
            >
              ← Back to Blog
            </Link>
            <h1 className="text-4xl font-bold mb-6">{entry.title}</h1>

          {/* Metadata section */}
          <div className="flex flex-col gap-4">
            {/* Author and Date row */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              {/* Author info */}
              {author && (
                <Link
                  href={`/blog/authors/${author.id}`}
                  className="flex items-center gap-3 hover:opacity-80 transition-all"
                >
                  <Avatar className="h-10 w-10">
                    {author.avatar && <AvatarImage src={author.avatar} alt={authorName} />}
                    <AvatarFallback>
                      {getInitials(authorName)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{authorName}</p>
                    <p className="text-xs text-muted-foreground">Author</p>
                  </div>
                </Link>
              )}

              {/* Date info */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <time dateTime={publishedDate.toISOString()}>
                  {formatDate(publishedDate)}
                </time>
                {modifiedDate.getTime() !== publishedDate.getTime() && (
                  <>
                    <span>•</span>
                    <span>Updated: {formatDate(modifiedDate)}</span>
                  </>
                )}
              </div>
            </div>

            {/* Tags row */}
            {entry.tags && entry.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-3 border-t">
                <CmsEntryTags
                  tags={entry.tags}
                  maxTags={Infinity}
                  variant="outline"
                  linkHref={(tag) => `/blog/tags/${tag.slug}`}
                />
              </div>
            )}
          </div>
        </header>

        {entry.featuredImageUrl && (
          <div className="relative w-full aspect-video mb-8 rounded-lg overflow-hidden">
            <Image
              src={entry.featuredImageUrl}
              alt={entry.featuredImage?.alt || entry.title}
              fill
              className="object-cover"
              priority
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 768px, 896px"
            />
          </div>
        )}

        <CmsContentRenderer
          content={entry.content as JSONContent}
          className="tiptap ProseMirror blog-content"
        />
      </article>
    </div>
    </>
  )
}
