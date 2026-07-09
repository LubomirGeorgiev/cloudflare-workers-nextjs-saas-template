import "server-only"
import { Link } from "@/i18n/navigation"
import { cache } from "react"
import { notFound, redirect } from "next/navigation"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { getCmsCollection } from "@/lib/cms/entry"
import { hasPublishedBlogPosts } from "@/lib/blog-visibility"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getInitials } from "@/utils/name-initials"
import { BlogCard } from "@/components/blog-card"
import { SITE_NAME, SITE_URL } from "@/constants"
import {
  getAuthorDisplayName,
  getAuthorRouteParam,
  parseAuthorIdFromRouteParam,
} from "@/utils/blog-author-url"
import type { Person, WithContext } from "schema-dts"
import { LOCALES, type Locale } from "@/i18n/config"
import { buildAlternates } from "@/utils/i18n-metadata"

type AuthorPageProps = {
  params: Promise<{
    locale: Locale
    authorId: string
  }>
}

const getCachedBlogEntriesWithAuthors = cache(async (locale: Locale) => {
  return getCmsCollection({
    collectionSlug: "blog",
    includeRelations: { createdByUser: true, tags: true },
    locale,
  })
})

export async function generateMetadata({
  params,
}: AuthorPageProps): Promise<Metadata> {
  const { locale, authorId: authorRouteParam } = await params
  const t = await getTranslations({ locale, namespace: "Blog.AuthorDetail.meta" })
  const parsedAuthorId = parseAuthorIdFromRouteParam(authorRouteParam)

  if (!parsedAuthorId) {
    return {
      title: t("notFound"),
    }
  }

  const blogEntries = await getCachedBlogEntriesWithAuthors(locale)

  const authorEntries = blogEntries.filter(
    entry => entry.createdByUser?.id === parsedAuthorId
  )

  if (authorEntries.length === 0) {
    return {
      title: t("notFound"),
    }
  }

  const author = authorEntries[0].createdByUser!
  const authorName = getAuthorDisplayName(author)
  const canonicalAuthorParam = getAuthorRouteParam(author)

  const avatarUrl = author.avatar ? `${SITE_URL}${author.avatar}` : undefined

  const title = t("title", { name: authorName })
  const description = t("description", { name: authorName })

  return {
    title,
    description,
    // This listing page renders in every locale, so every locale gets an
    // hreflang entry.
    alternates: buildAlternates({
      pathname: `/blog/authors/${canonicalAuthorParam}`,
      locale,
      availableLocales: LOCALES,
    }),
    openGraph: {
      title,
      description,
      type: "profile",
      url: `/blog/authors/${canonicalAuthorParam}`,
      ...(avatarUrl && {
        images: [avatarUrl],
      }),
    },
    twitter: {
      card: "summary",
      title,
      description,
      ...(avatarUrl && {
        images: [avatarUrl],
      }),
    },
  }
}

export default async function AuthorPage({ params }: AuthorPageProps) {
  const t = await getTranslations("Blog.AuthorDetail")
  const { locale, authorId: authorRouteParam } = await params
  const parsedAuthorId = parseAuthorIdFromRouteParam(authorRouteParam)

  if (!parsedAuthorId) {
    notFound()
  }

  const blogEntries = await getCachedBlogEntriesWithAuthors(locale)

  // Empty only in this locale falls through to the per-author notFound below;
  // redirect home only when the blog has no published posts at all.
  if (blogEntries.length === 0 && !(await hasPublishedBlogPosts())) {
    redirect("/")
  }

  const authorEntries = blogEntries.filter(
    entry => entry.createdByUser?.id === parsedAuthorId
  )

  if (authorEntries.length === 0) {
    notFound()
  }

  const author = authorEntries[0].createdByUser!
  const authorName = getAuthorDisplayName(author)
  const canonicalAuthorParam = getAuthorRouteParam(author)

  if (authorRouteParam !== canonicalAuthorParam) {
    redirect(`/blog/authors/${canonicalAuthorParam}`)
  }

  // JSON-LD structured data for Person
  const jsonLd: WithContext<Person> = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: authorName,
    url: `${SITE_URL}/blog/authors/${canonicalAuthorParam}`,
    ...(author.avatar && {
      image: `${SITE_URL}${author.avatar}`,
    }),
    ...(author.email && {
      email: author.email,
    }),
    worksFor: {
      "@type": "Organization",
      name: SITE_NAME,
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
          {t("backToAuthors")}
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
              {t("postCount", { count: authorEntries.length })}
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
