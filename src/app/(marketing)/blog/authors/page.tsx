import "server-only"
import Link from "next/link"
import type { Metadata } from "next"
import { getCmsCollection } from "@/lib/cms/cms-repository"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getAuthorDisplayName, getAuthorRouteParam } from "@/utils/blog-author-url"
import { getInitials } from "@/utils/name-initials"
import type { CollectionPage, WithContext } from "schema-dts"

export const metadata: Metadata = {
  title: "Blog Authors",
  description: "Browse blog posts by author",
  alternates: {
    canonical: "/blog/authors",
  },
  openGraph: {
    title: "Blog Authors",
    description: "Browse blog posts by author",
    type: "website",
    url: "/blog/authors",
  },
  twitter: {
    card: "summary",
    title: "Blog Authors",
    description: "Browse blog posts by author",
  },
}

export default async function BlogAuthorsPage() {
  // Get all blog entries with author information
  const blogEntries = await getCmsCollection({
    collectionSlug: 'blog',
    includeRelations: { createdByUser: true },
  })

  // Group entries by author
  const authorMap = new Map<string, {
    id: string
    firstName: string | null
    lastName: string | null
    email: string | null
    avatar: string | null
    postCount: number
  }>()

  blogEntries.forEach(entry => {
    if (entry.createdByUser) {
      const authorId = entry.createdByUser.id
      const existing = authorMap.get(authorId)

      if (existing) {
        existing.postCount++
      } else {
        authorMap.set(authorId, {
          id: entry.createdByUser.id,
          firstName: entry.createdByUser.firstName,
          lastName: entry.createdByUser.lastName,
          email: entry.createdByUser.email,
          avatar: entry.createdByUser.avatar,
          postCount: 1,
        })
      }
    }
  })

  const authors = Array.from(authorMap.values()).sort((a, b) => b.postCount - a.postCount)

  // JSON-LD structured data for CollectionPage
  const jsonLd: WithContext<CollectionPage> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Blog Authors",
    description: "Meet the people behind our content",
    ...(authors.length > 0 && {
      mainEntity: {
        "@type": "ItemList",
        itemListElement: authors.map((author, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "Person",
            name: getAuthorDisplayName(author),
            ...(author.email && {
              email: author.email,
            }),
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
        <h1 className="text-4xl font-bold mb-4">Blog Authors</h1>
        <p className="text-xl text-muted-foreground">
          Meet the people behind our content
        </p>
      </div>

      {authors.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No authors found.</p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {authors.map((author) => (
            <Link
              key={author.id}
              href={`/blog/authors/${getAuthorRouteParam(author)}`}
              className="group block"
            >
              <div className="h-full border rounded-lg p-6 transition-all hover:shadow-lg hover:border-primary">
                <div className="flex items-center gap-4 mb-3">
                  <Avatar className="h-12 w-12">
                    {author.avatar && <AvatarImage src={author.avatar} alt={getAuthorDisplayName(author)} />}
                    <AvatarFallback>
                      {getInitials(getAuthorDisplayName(author))}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h2 className="text-xl font-semibold group-hover:text-primary transition-all">
                      {getAuthorDisplayName(author)}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {author.postCount} {author.postCount === 1 ? 'post' : 'posts'}
                    </p>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
    </>
  )
}
