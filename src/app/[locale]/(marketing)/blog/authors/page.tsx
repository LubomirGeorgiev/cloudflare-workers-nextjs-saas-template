import "server-only"
import { Link } from "@/i18n/navigation"
import { redirect } from "next/navigation"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { getCmsCollection } from "@/lib/cms/entry"
import { hasPublishedBlogPosts } from "@/lib/blog-visibility"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getAuthorDisplayName, getAuthorRouteParam } from "@/utils/blog-author-url"
import { getInitials } from "@/utils/name-initials"
import type { CollectionPage, WithContext } from "schema-dts"
import { LOCALES, type Locale } from "@/i18n/config"
import { buildAlternates } from "@/utils/i18n-metadata"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Blog.Authors.meta" });
  const title = t("title");
  const description = t("description");

  return {
    title,
    description,
    // This listing page renders in every locale, so every locale gets an
    // hreflang entry.
    alternates: buildAlternates({ pathname: "/blog/authors", locale, availableLocales: LOCALES }),
    openGraph: {
      title,
      description,
      type: "website",
      url: "/blog/authors",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function BlogAuthorsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const t = await getTranslations("Blog.Authors")
  const { locale } = await params

  const blogEntries = await getCmsCollection({
    collectionSlug: 'blog',
    includeRelations: { createdByUser: true },
    locale,
  })

  // Empty only in this locale still renders the localized empty state; redirect
  // home only when the blog has no published posts at all.
  if (blogEntries.length === 0 && !(await hasPublishedBlogPosts())) {
    redirect("/")
  }

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
    name: t("meta.title"),
    inLanguage: locale,
    description: t("description"),
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
          {t("backToBlog")}
        </Link>
        <h1 className="text-4xl font-bold mb-4">{t("title")}</h1>
        <p className="text-xl text-muted-foreground">
          {t("description")}
        </p>
      </div>

      {authors.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">{t("empty")}</p>
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
                      {t("postCount", { count: author.postCount })}
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
