import { notFound } from "next/navigation"
import { formatDate } from "@/utils/format-date"
import type { Metadata } from "next"
import { getCmsEntryBySlug } from "@/lib/cms/cms-repository"

import "@/components/tiptap-templates/simple/cms-content-styles.scss"

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

  // TODO We need to have a meta description field in the cms_entries table and integrate
  // with Cloudflare Workers AI to automatically regenerate it on every update
  const plainText = entry.renderedContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const description = plainText.length > 160
    ? plainText.substring(0, 157) + '...'
    : plainText

  return {
    title: entry.title,
    description: description || entry.title,
    openGraph: {
      title: entry.title,
      description: description || entry.title,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: entry.title,
      description: description || entry.title,
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

        <div
          className="tiptap ProseMirror blog-content"
          dangerouslySetInnerHTML={{ __html: entry.renderedContent }}
        />
      </article>
    </div>
  )
}
