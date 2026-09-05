import "server-only"
import { getTranslator } from "@/i18n/translator";
import { notFound } from "next/navigation"
import { redirect } from "@/i18n/navigation"
import type { Metadata } from "next"
import { getBlogFacetPage, getBlogPageCounts } from "@/lib/cms/blog-list-artifacts"
import { BlogPaginationServer } from "@/components/blog-pagination-server"
import {
  getLocalesWithBlogPage,
  isBlogPageOutOfRange,
  requireBlogCollectionPage,
  sliceBlogPage,
} from "@/lib/blog-pagination"
import { getBlogCollectionPagePath } from "@/lib/blog-routing"
import { hasPublishedBlogPosts } from "@/lib/blog-visibility"
import { BlogCard } from "@/components/blog-card"
import { BlogBackLink } from "@/components/blog-back-link"
import { BlogEmptyState } from "@/components/blog-empty-state"
import { BLOG_POSTS_PER_PAGE } from "@/constants"
import { getOpenGraphLocales, type Locale } from "@/i18n/config"
import { buildPaginatedAlternates } from "@/utils/i18n-metadata"
import { absoluteLocalizedUrl } from "@/utils/i18n-urls"
import { buildBlogTagGraph } from "@/lib/seo/blog-json-ld"
import { JsonLd } from "@/lib/seo/json-ld"

type TagPageProps = {
  params: Promise<{
    page?: string
    locale: Locale
    slug: string
  }>
}

export async function generateMetadata({
  params,
}: TagPageProps): Promise<Metadata> {
  const { locale, slug, page: pageParam } = await params
  const page = requireBlogCollectionPage({ pathname: `/blog/tags/${slug}`, pageParam, locale });
  const tMeta = await getTranslator({ locale, namespace: "Blog.TagDetail.meta" })
  const facetPage = await getBlogFacetPage({ locale, facet: { type: "tag", slug } })
  const tag = facetPage?.subject

  if (!tag) {
    return {
      title: tMeta("notFound"),
    }
  }

  const title = tMeta("title", { name: tag.name })
  const description = tag.description || tMeta("description", { name: tag.name })
  // A tag has fewer posts in some locales, so a numbered page exists only in the
  // locales whose count reaches it.
  const pageCounts = await getBlogPageCounts({ pathname: `/blog/tags/${slug}` })

  return {
    title,
    description,
    alternates: buildPaginatedAlternates({
      pathname: getBlogCollectionPagePath({ pathname: `/blog/tags/${slug}`, page }),
      locale,
      availableLocales: getLocalesWithBlogPage({ pageCounts, page }),
      page,
    }),
    openGraph: {
      ...getOpenGraphLocales(locale),
      title,
      description,
      type: "website",
      url: absoluteLocalizedUrl({ pathname: getBlogCollectionPagePath({ pathname: `/blog/tags/${slug}`, page }), locale }),
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  }
}

export default async function TagPage({ params }: TagPageProps) {
  const { locale, slug, page: pageParam } = await params
  const page = requireBlogCollectionPage({ pathname: `/blog/tags/${slug}`, pageParam, locale });
  const t = await getTranslator({ locale, namespace: "Blog.TagDetail" })
  const tCommon = await getTranslator({ locale, namespace: "Blog.Common" })

  const facetPage = await getBlogFacetPage({ locale, facet: { type: "tag", slug } })
  if (!facetPage) {
    notFound();
  }

  const tag = facetPage.subject;
  if (!facetPage.hasPosts && !(await hasPublishedBlogPosts())) {
    redirect({ href: "/", locale });
  }

  const totalCount = facetPage.posts.length;
  const totalPages = Math.ceil(totalCount / BLOG_POSTS_PER_PAGE);
  const blogEntries = sliceBlogPage({ items: facetPage.posts, page });

  if (isBlogPageOutOfRange({ page, totalCount })) {
    notFound();
  }

  const graph = await buildBlogTagGraph({ locale, tag, posts: blogEntries, page })

  return (
    <>
      <JsonLd graph={graph} />
      <div className="mx-auto max-w-7xl py-12 sm:py-16">
        <div className="mb-12">
          <BlogBackLink href="/blog/tags" label={t("backToTags")} />
          <div className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <h1 className="flex items-center gap-3 font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {/* The dot carries the tag's CMS-assigned color; the ring keeps it visible on matching backgrounds. */}
              {tag.color && (
                <span
                  aria-hidden
                  className="size-3.5 shrink-0 rounded-full ring-1 ring-inset ring-foreground/20"
                  style={{ backgroundColor: tag.color }}
                />
              )}
              {tag.name}
            </h1>
            <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              {tCommon("postCount", { count: totalCount })}
            </span>
          </div>
          {tag.description && (
            <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
              {tag.description}
            </p>
          )}
        </div>

        {blogEntries.length === 0 ? (
          <BlogEmptyState message={t("empty")} />
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {blogEntries.map((entry) => (
              <BlogCard key={entry.id} locale={locale} entry={entry} showTags={false} />
            ))}
          </div>
        )}
        <BlogPaginationServer
          pathname={`/blog/tags/${slug}`}
          currentPage={page}
          totalPages={totalPages}
          locale={locale}
        />
      </div>
    </>
  )
}
