import "server-only"
import Link from "next/link"
import { formatDate } from "@/utils/format-date"
import type { Metadata } from "next"
import { getCmsCollection } from "@/lib/cms/cms-repository"

export const metadata: Metadata = {
  title: "Blog",
  description: "Read our latest articles and updates",
}

export default async function BlogPage() {
  const blogEntries = await getCmsCollection({
    collectionSlug: 'blog',
  })

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
