import "server-only"
import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { getCmsCollection } from "@/lib/cms/cms-repository"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getInitials } from "@/utils/name-initials"
import { BlogCard } from "@/components/blog-card"
import { SITE_URL } from "@/constants"
import type { Person, WithContext } from "schema-dts"

type AuthorPageProps = {
  params: Promise<{
    authorId: string
  }>
}

export async function generateMetadata({
  params,
}: AuthorPageProps): Promise<Metadata> {
  const { authorId } = await params

  const blogEntries = await getCmsCollection({
    collectionSlug: 'blog',
    includeRelations: { createdByUser: true, tags: true },
  })

  const authorEntries = blogEntries.filter(
    entry => entry.createdByUser?.id === authorId
  )

  if (authorEntries.length === 0) {
    return {
      title: "Author Not Found",
    }
  }

  const author = authorEntries[0].createdByUser!
  const authorName = [author.firstName, author.lastName].filter(Boolean).join(' ') || author.email || 'Unknown Author'

  const avatarUrl = author.avatar ? `${SITE_URL}${author.avatar}` : undefined

  return {
    title: `${authorName} - Blog Authors`,
    description: `Browse blog posts by ${authorName}`,
    alternates: {
      canonical: `/blog/authors/${authorId}`,
    },
    openGraph: {
      title: `${authorName} - Blog Authors`,
      description: `Browse blog posts by ${authorName}`,
      type: "profile",
      url: `/blog/authors/${authorId}`,
      ...(avatarUrl && {
        images: [avatarUrl],
      }),
    },
    twitter: {
      card: "summary",
      title: `${authorName} - Blog Authors`,
      description: `Browse blog posts by ${authorName}`,
      ...(avatarUrl && {
        images: [avatarUrl],
      }),
    },
  }
}

export default async function AuthorPage({ params }: AuthorPageProps) {
  const { authorId } = await params

  const blogEntries = await getCmsCollection({
    collectionSlug: 'blog',
    includeRelations: { createdByUser: true, tags: true },
  })

  const authorEntries = blogEntries.filter(
    entry => entry.createdByUser?.id === authorId
  )

  if (authorEntries.length === 0) {
    notFound()
  }

  const author = authorEntries[0].createdByUser!
  const authorName = [author.firstName, author.lastName].filter(Boolean).join(' ') || author.email || 'Unknown Author'

  // JSON-LD structured data for Person
  const jsonLd: WithContext<Person> = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: authorName,
    url: `${SITE_URL}/blog/authors/${authorId}`,
    ...(author.avatar && {
      image: `${SITE_URL}${author.avatar}`,
    }),
    ...(author.email && {
      email: author.email,
    }),
    worksFor: {
      "@type": "Organization",
      name: "SaaS Template",
    },
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
          href="/blog/authors"
          className="text-sm text-muted-foreground hover:text-primary transition-all mb-4 inline-block"
        >
          ← Back to all authors
        </Link>
        <div className="flex items-center gap-4 mb-4">
          <Avatar className="h-16 w-16">
            {author.avatar && <AvatarImage src={author.avatar} alt={authorName} />}
            <AvatarFallback className="text-lg">
              {getInitials(authorName)}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-4xl font-bold">{authorName}</h1>
            <p className="text-muted-foreground">
              {authorEntries.length} {authorEntries.length === 1 ? 'post' : 'posts'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        {authorEntries.map((entry) => (
          <BlogCard key={entry.id} entry={entry} showAuthor={false} />
        ))}
      </div>
    </div>
    </>
  )
}
