import "server-only"
import { getTranslator } from "@/i18n/translator";
import { Link, redirect } from "@/i18n/navigation"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { Tag, Users } from "lucide-react"
import { getCmsCollection, getCmsCollectionCount } from "@/lib/cms/entry"
import { BlogCard } from "@/components/blog-card"
import { BlogEmptyState } from "@/components/blog-empty-state"
import { BlogPaginationServer } from "@/components/blog-pagination-server"
import { BLOG_POSTS_PER_PAGE } from "@/constants"
import { BLOG_BASE_PATH, getBlogPagePath } from "@/lib/blog-routing"
import { getLocalesWithBlogPage, isBlogPageOutOfRange } from "@/lib/blog-pagination"
import { getBlogPageCounts } from "@/lib/cms/blog-list-artifacts"
import { hasPublishedBlogPosts } from "@/lib/blog-visibility"
import { getOpenGraphLocales, type Locale } from "@/i18n/config"
import { buildPaginatedAlternates } from "@/utils/i18n-metadata"
import { absoluteLocalizedUrl } from "@/utils/i18n-urls"
import { buildBlogListGraph } from "@/lib/seo/blog-json-ld"
import { JsonLd } from "@/lib/seo/json-ld"

interface BlogListPageProps {
  page: number;
  locale: Locale;
}

export async function getBlogListPageMetadata({ page, locale }: { page: number; locale: Locale }): Promise<Metadata> {
  const isFirstPage = page === 1
  const t = await getTranslator({ locale, namespace: "Blog.ListPage.meta" })
  const title = isFirstPage ? t("title") : t("titleWithPage", { page })
  const description = t("description")
  const pagePath = getBlogPagePath({ page })
  // Page one renders in every locale; a numbered page only where that locale has
  // enough posts, so hreflang names just those locales.
  const pageCounts = await getBlogPageCounts({ pathname: BLOG_BASE_PATH })

  return {
    title,
    description,
    alternates: buildPaginatedAlternates({
      pathname: pagePath,
      locale,
      availableLocales: getLocalesWithBlogPage({ pageCounts, page }),
      page,
    }),
    openGraph: {
      ...getOpenGraphLocales(locale),
      title,
      description,
      type: "website",
      url: absoluteLocalizedUrl({ pathname: pagePath, locale }),
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  }
}

export async function BlogListPage({ page, locale }: BlogListPageProps) {
  const t = await getTranslator({ locale, namespace: "Blog.ListPage" })
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
    redirect({ href: "/", locale })
  }

  if (isBlogPageOutOfRange({ page, totalCount })) {
    notFound()
  }

  const graph = await buildBlogListGraph({ locale, page, posts: blogEntries })

  return (
    <>
      <JsonLd graph={graph} />
      {/* Negative margins cancel the blog layout's horizontal padding so the
          grid backdrop bleeds full width and meets the nav with no gap. */}
      <header className="relative isolate -mx-4 overflow-hidden md:-mx-6 lg:-mx-8">
        {/* Grid lines derive from the foreground color so they read clearly in both themes. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-grid [--border:color-mix(in_oklab,var(--foreground)_13%,transparent)] mask-[radial-gradient(ellipse_80%_110%_at_30%_0%,black,transparent_90%)]"
        />
        <div className="mx-auto max-w-7xl px-4 pb-12 pt-12 md:px-6 sm:pb-14 sm:pt-16 lg:px-8">
          <h1 className="font-display text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">
            {t("title")}
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
            {t("description")}
          </p>

          {/* Navigation links */}
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/blog/tags"
              className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-4 py-1.5 text-sm text-muted-foreground backdrop-blur-sm transition-colors hover:border-edge/60 hover:text-edge"
            >
              <Tag className="size-3.5" strokeWidth={1.75} aria-hidden />
              {t("browseByTags")}
            </Link>
            <Link
              href="/blog/authors"
              className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-4 py-1.5 text-sm text-muted-foreground backdrop-blur-sm transition-colors hover:border-edge/60 hover:text-edge"
            >
              <Users className="size-3.5" strokeWidth={1.75} aria-hidden />
              {t("browseByAuthors")}
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl pb-12 sm:pb-16">

        {blogEntries.length === 0 ? (
          <BlogEmptyState message={t("empty")} />
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {blogEntries.map((entry) => (
                <BlogCard key={entry.id} locale={locale} entry={entry} />
              ))}
            </div>

            <div className="mt-14">
              <BlogPaginationServer
                pathname={BLOG_BASE_PATH}
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
