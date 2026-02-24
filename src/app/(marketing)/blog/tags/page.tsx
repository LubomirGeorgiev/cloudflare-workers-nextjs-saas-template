import "server-only"
import Link from "next/link"
import type { Metadata } from "next"
import { getCmsTags } from "@/lib/cms/cms-repository"
import { Badge } from "@/components/ui/badge"
import type { CollectionPage, WithContext } from "schema-dts"

export const metadata: Metadata = {
  title: "Blog Tags",
  description: "Browse blog posts by tag",
  alternates: {
    canonical: "/blog/tags",
  },
  openGraph: {
    title: "Blog Tags",
    description: "Browse blog posts by tag",
    type: "website",
    url: "/blog/tags",
  },
  twitter: {
    card: "summary",
    title: "Blog Tags",
    description: "Browse blog posts by tag",
  },
}

export default async function BlogTagsPage() {
  const tags = await getCmsTags()

  // Only show tags that have entries
  const tagsWithEntries = tags.filter(tag => tag.entryCount > 0)

  // JSON-LD structured data for CollectionPage
  const jsonLd: WithContext<CollectionPage> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Blog Tags",
    description: "Browse blog posts by tag",
    ...(tagsWithEntries.length > 0 && {
      mainEntity: {
        "@type": "ItemList",
        itemListElement: tagsWithEntries.map((tag, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "DefinedTerm",
            name: tag.name,
            ...(tag.description && { description: tag.description }),
          },
        })),
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
          href="/blog"
          className="text-sm text-muted-foreground hover:text-primary transition-all mb-4 inline-block"
        >
          ← Back to Blog
        </Link>
        <h1 className="text-4xl font-bold mb-4">Blog Tags</h1>
        <p className="text-xl text-muted-foreground">
          Browse articles by topic
        </p>
      </div>

      {tagsWithEntries.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No tags found.</p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {tagsWithEntries.map((tag) => (
            <Link
              key={tag.id}
              href={`/blog/tags/${tag.slug}`}
              className="group block"
            >
              <div className="h-full border rounded-lg p-6 transition-all hover:shadow-lg hover:border-primary">
                <div className="flex items-center justify-between mb-3">
                  <Badge
                    variant="secondary"
                    style={tag.color ? { backgroundColor: tag.color, color: 'white' } : undefined}
                    className="group-hover:scale-105 transition-all border-secondary"
                  >
                    {tag.name}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {tag.entryCount} {tag.entryCount === 1 ? 'post' : 'posts'}
                  </span>
                </div>
                {tag.description && (
                  <p className="text-sm text-muted-foreground">
                    {tag.description}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
    </>
  )
}
