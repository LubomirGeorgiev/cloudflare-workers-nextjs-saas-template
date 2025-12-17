import "server-only"
import { getDB } from "@/db"
import { cmsEntryTable } from "@/db/schema"
import { CMS_ENTRY_STATUS } from "@/app/enums"
import { eq, and, desc } from "drizzle-orm"
import { cmsConfig } from "@/../cms.config"
import Link from "next/link"
import { formatDate } from "@/utils/format-date"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Blog",
  description: "Read our latest articles and updates",
}

export default async function BlogPage() {
  const db = getDB()

  const blogEntries = await db
    .select({
      id: cmsEntryTable.id,
      title: cmsEntryTable.title,
      slug: cmsEntryTable.slug,
      createdAt: cmsEntryTable.createdAt,
      updatedAt: cmsEntryTable.updatedAt,
      fields: cmsEntryTable.fields,
    })
    .from(cmsEntryTable)
    .where(
      and(
        eq(cmsEntryTable.collection, cmsConfig.collections.blog.slug),
        eq(cmsEntryTable.status, CMS_ENTRY_STATUS.PUBLISHED)
      )
    )
    .orderBy(desc(cmsEntryTable.createdAt))

  return (
    <div className="container mx-auto py-12">
      <div className="mb-12">
        <h1 className="text-4xl font-bold mb-4">Blog</h1>
        <p className="text-xl text-muted-foreground">
          Read our latest articles and updates
        </p>
      </div>

      {blogEntries.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No blog posts published yet.</p>
        </div>
      ) : (
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {blogEntries.map((entry) => (
            <Link
              key={entry.id}
              href={`/blog/${entry.slug}`}
              className="group block"
            >
              <article className="h-full border rounded-lg p-6 transition-all hover:shadow-lg hover:border-primary">
                <h2 className="text-2xl font-semibold mb-3 group-hover:text-primary transition-colors">
                  {entry.title}
                </h2>
                <time
                  dateTime={entry.createdAt.toISOString()}
                  className="text-sm text-muted-foreground"
                >
                  {formatDate(entry.createdAt)}
                </time>
              </article>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
