import "server-only"
import { Link } from "@/i18n/navigation"
import { notFound, redirect } from "next/navigation"
import type { Metadata } from "next"
import type { Blog, WithContext } from "schema-dts"
import { getTranslations } from "next-intl/server"
import { getCmsCollection, getCmsCollectionCount } from "@/lib/cms/entry"
import { BlogCard } from "@/components/blog-card"
import { BlogPaginationServer } from "@/components/blog-pagination-server"
import { BLOG_POSTS_PER_PAGE } from "@/constants"
import { getBlogPagePath } from "@/lib/blog-routing"
import { hasPublishedBlogPosts } from "@/lib/blog-visibility"
import { getCmsEntryDates } from "@/utils/cms-entry-dates"
import { LOCALES, type Locale } from "@/i18n/config"
import { buildAlternates } from "@/utils/i18n-metadata"

interface BlogListPageProps {
  page: number;
  locale: Locale;
}

export async function getBlogListPageMetadata({ page, locale }: { page: number; locale: Locale }): Promise<Metadata> {
  const isFirstPage = page === 1
  const t = await getTranslations({ locale, namespace: "Blog.ListPage.meta" })
  const title = isFirstPage ? t("title") : t("titleWithPage", { page })
  const description = t("description")
  const pagePath = getBlogPagePath({ page })

  return {
    title,
    description,
    // The listing page itself renders in every locale (localized chrome +
    // locale-filtered posts), so every locale gets an hreflang entry.
    alternates: buildAlternates({ pathname: pagePath, locale, availableLocales: LOCALES }),
    openGraph: {
      title,
      description,
      type: "website",
      url: pagePath,
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  }
}

export async function BlogListPage({ page, locale }: BlogListPageProps) {
  const t = await getTranslations("Blog.ListPage")
  const offset = (page - 1) * BLOG_POSTS_PER_PAGE

  const [blogEntries, totalCount] = await Promise.all([
    getCmsCollection({
      collectionSlug: 'blog',
      includeRelations: { tags: true, createdByUser: true },
      limit: BLOG_POSTS_PER_PAGE,
      offset,
      locale,
    }),
    getCmsCollectionCount({
      collectionSlug: 'blog',
      status: 'published',
      locale,
    }),
  ])

  const totalPages = Math.ceil(totalCount / BLOG_POSTS_PER_PAGE)

  // Only bounce home when the blog has no published posts at all; a locale with
  // no translated posts still renders its localized empty state below.
  if (totalCount === 0 && page === 1 && !(await hasPublishedBlogPosts())) {
    redirect("/")
  }

  if (page < 1 || (page > 1 && (totalCount === 0 || page > totalPages))) {
    notFound()
  }

  // JSON-LD structured data for Blog
  const jsonLd: WithContext<Blog> = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: t("meta.title"),
    inLanguage: locale,
    description: t("meta.description"),
    ...(blogEntries.length > 0 && {
      blogPost: blogEntries.map((entry) => {
        const authorName = entry.createdByUser
          ? [entry.createdByUser.firstName, entry.createdByUser.lastName].filter(Boolean).join(' ') || entry.createdByUser.email || undefined
          : undefined

        const { publishedDate, modifiedDate } = getCmsEntryDates({
          publishedAt: entry.publishedAt,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        })

        return {
          "@type": "BlogPosting" as const,
          headline: entry.title,
          datePublished: publishedDate.toISOString(),
          dateModified: modifiedDate.toISOString(),
          ...(entry.featuredImageUrl && {
            image: entry.featuredImageUrl,
          }),
          ...(authorName && {
            author: {
              "@type": "Person" as const,
              name: authorName,
            },
          }),
        }
      }),
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
          <h1 className="text-4xl font-bold mb-4">{t("title")}</h1>
          <p className="text-xl text-muted-foreground mb-6">
            {t("description")}
          </p>

          {/* Navigation links */}
          <div className="flex gap-4">
            <Link
              href="/blog/tags"
              className="text-sm text-muted-foreground hover:text-primary transition-all underline"
            >
              {t("browseByTags")}
            </Link>
            <span className="text-muted-foreground">•</span>
            <Link
              href="/blog/authors"
              className="text-sm text-muted-foreground hover:text-primary transition-all underline"
            >
              {t("browseByAuthors")}
            </Link>
          </div>
        </div>

        {blogEntries.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">{t("empty")}</p>
          </div>
        ) : (
          <>
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {blogEntries.map((entry) => (
                <BlogCard key={entry.id} entry={entry} />
              ))}
            </div>

            <div className="mt-12">
              <BlogPaginationServer
                currentPage={page}
                totalPages={totalPages}
                locale={locale}
              />
            </div>
          </>
        )}
      </div>
    </>
  )
}
