import { notFound } from "next/navigation"
import { formatDate } from "@/utils/format-date"
import type { Metadata } from "next"
import { getCmsEntryBySlug } from "@/lib/cms/cms-repository"
import { CmsContentRenderer } from "@/components/cms-content-renderer"
import { generateMetaDescription } from "@/lib/cms/extract-text-from-content"
import type { JSONContent } from "@tiptap/core"
import Image from "next/image"
import { SITE_URL } from "@/constants"

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

  const description = entry.seoDescription || generateMetaDescription(entry.content as JSONContent)
  const featuredImageUrl = entry.featuredImageUrl ? `${SITE_URL}${entry.featuredImageUrl}` : undefined

  return {
    title: entry.title,
    description: description || entry.title,
    openGraph: {
      title: entry.title,
      description: description || entry.title,
      type: 'article',
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
  })

  if (!entry) {
    notFound()
  }

  return (
    <div className="container mx-auto py-12">
      <article className="max-w-3xl mx-auto">
        <header className="mb-8">
          <h1 className="text-4xl font-bold mb-4">{entry.title}</h1>
          <div className="flex items-center gap-4 text-muted-foreground">
            <time dateTime={entry.createdAt.toISOString()}>
              {formatDate(entry.createdAt)}
            </time>
            {entry.updatedAt.getTime() !== entry.createdAt.getTime() && (
              <span>
                • Updated: {formatDate(entry.updatedAt)}
              </span>
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
  )
}
