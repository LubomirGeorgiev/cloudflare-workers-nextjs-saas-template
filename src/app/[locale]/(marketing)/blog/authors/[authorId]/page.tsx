import "server-only"
import { cache } from "react"
import { notFound } from "next/navigation"
import { redirect } from "@/i18n/navigation"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { getCmsCollection } from "@/lib/cms/entry"
import { hasPublishedBlogPosts } from "@/lib/blog-visibility"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getInitials } from "@/utils/name-initials"
import { BlogCard } from "@/components/blog-card"
import { BlogBackLink } from "@/components/blog-back-link"
import { SITE_NAME, SITE_URL } from "@/constants"
import {
  getAuthorDisplayName,
  getAuthorRouteParam,
  parseAuthorIdFromRouteParam,
} from "@/utils/blog-author-url"
import type { Person, WithContext } from "schema-dts"
import { getOpenGraphLocales, LOCALES, type Locale } from "@/i18n/config"
import { buildAlternates } from "@/utils/i18n-metadata"
import { absoluteLocalizedUrl } from "@/utils/i18n-urls"

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
  const tDetail = await getTranslations({ locale, namespace: "Blog.AuthorDetail" })
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
  const authorName = getAuthorDisplayName(author, tDetail("unknownAuthor"))
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
      ...getOpenGraphLocales(locale),
      title,
      description,
      type: "profile",
      url: absoluteLocalizedUrl({ pathname: `/blog/authors/${canonicalAuthorParam}`, locale }),
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
    redirect({ href: "/", locale })
  }

  const authorEntries = blogEntries.filter(
    entry => entry.createdByUser?.id === parsedAuthorId
  )

  if (authorEntries.length === 0) {
    notFound()
  }

  const author = authorEntries[0].createdByUser!
  const authorName = getAuthorDisplayName(author, t("unknownAuthor"))
  const canonicalAuthorParam = getAuthorRouteParam(author)

  if (authorRouteParam !== canonicalAuthorParam) {
    redirect({ href: `/blog/authors/${canonicalAuthorParam}`, locale })
  }

  // JSON-LD structured data for Person
  const jsonLd: WithContext<Person> = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: authorName,
    url: absoluteLocalizedUrl({ pathname: `/blog/authors/${canonicalAuthorParam}`, locale }),
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
      <div className="mx-auto max-w-7xl py-12 sm:py-16">
        <div className="mb-12">
          <BlogBackLink href="/blog/authors" label={t("backToAuthors")} />
          <div className="mt-6 flex items-center gap-5">
            <Avatar className="h-16 w-16 ring-1 ring-border sm:h-20 sm:w-20">
              {author.avatar && <AvatarImage src={author.avatar} alt={authorName} />}
              <AvatarFallback className="text-lg">
                {getInitials(authorName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                {authorName}
              </h1>
              <p className="mt-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                {t("postCount", { count: authorEntries.length })}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {authorEntries.map((entry) => (
            <BlogCard key={entry.id} entry={entry} showAuthor={false} />
          ))}
        </div>
      </div>
    </>
  )
}
