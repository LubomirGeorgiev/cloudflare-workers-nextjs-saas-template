import { getDB } from "@/db"
import { cmsEntryTable } from "@/db/schema"
import { CMS_ENTRY_STATUS } from "@/app/enums"
import { eq, and } from "drizzle-orm"
import { cmsConfig } from "@/../cms.config"
import { notFound } from "next/navigation"
import { formatDate } from "@/utils/format-date"
import type { Metadata } from "next"
import { renderCmsContent } from "@/lib/render-cms-content"

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
  const db = getDB()

  const entry = await db
    .select({
      title: cmsEntryTable.title,
      content: cmsEntryTable.content,
      fields: cmsEntryTable.fields,
    })
    .from(cmsEntryTable)
    .where(
      and(
        eq(cmsEntryTable.collection, cmsConfig.collections.blog.slug),
        eq(cmsEntryTable.slug, slug),
        eq(cmsEntryTable.status, CMS_ENTRY_STATUS.PUBLISHED)
      )
    )
    .get()

  if (!entry) {
    return {
      title: "Blog Post Not Found",
    }
  }

  // TODO We need to have a meta description field in the cms_entries table and integrate
  // with Cloudflare Workers AI to automatically regenerate it on every update
  const htmlContent = renderCmsContent(entry.content)

  const plainText = htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
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
  const db = getDB()

  const entry = await db
    .select({
      id: cmsEntryTable.id,
      title: cmsEntryTable.title,
      content: cmsEntryTable.content,
      createdAt: cmsEntryTable.createdAt,
      updatedAt: cmsEntryTable.updatedAt,
      fields: cmsEntryTable.fields,
    })
    .from(cmsEntryTable)
    .where(
      and(
        eq(cmsEntryTable.collection, cmsConfig.collections.blog.slug),
        eq(cmsEntryTable.slug, slug),
        eq(cmsEntryTable.status, CMS_ENTRY_STATUS.PUBLISHED)
      )
    )
    .get()

  if (!entry) {
    notFound()
  }

  // TODO Cache this in Cloudflare KV
  const htmlContent = renderCmsContent(entry.content)

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
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      </article>
    </div>
  )
}
