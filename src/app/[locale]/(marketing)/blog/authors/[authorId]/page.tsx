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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getInitials } from "@/utils/name-initials"
import { BlogCard } from "@/components/blog-card"
import { BlogBackLink } from "@/components/blog-back-link"
import { BLOG_POSTS_PER_PAGE, SITE_URL } from "@/constants"
import { buildBlogAuthorGraph } from "@/lib/seo/blog-json-ld"
import { JsonLd } from "@/lib/seo/json-ld"
import {
  getAuthorDisplayName,
  getAuthorRouteParam,
  parseAuthorIdFromRouteParam,
} from "@/utils/blog-author-url"
import { getOpenGraphLocales, type Locale } from "@/i18n/config"
import { buildPaginatedAlternates } from "@/utils/i18n-metadata"
import { absoluteLocalizedUrl } from "@/utils/i18n-urls"

type AuthorPageProps = {
  params: Promise<{
    page?: string
    locale: Locale
    authorId: string
  }>
}

export async function generateMetadata({
  params,
}: AuthorPageProps): Promise<Metadata> {
  const { locale, authorId: authorRouteParam, page: pageParam } = await params
  const page = requireBlogCollectionPage({ pathname: `/blog/authors/${authorRouteParam}`, pageParam, locale });
  const t = await getTranslator({ locale, namespace: "Blog.AuthorDetail.meta" })
  const tDetail = await getTranslator({ locale, namespace: "Blog.AuthorDetail" })
  const parsedAuthorId = parseAuthorIdFromRouteParam(authorRouteParam)

  if (!parsedAuthorId) {
    return {
      title: t("notFound"),
    }
  }

  const facetPage = await getBlogFacetPage({ locale, facet: { type: "author", authorId: parsedAuthorId } });
  if (!facetPage) {
    return { title: t("notFound") };
  }
  const author = facetPage.subject;

  const authorName = getAuthorDisplayName(author, tDetail("unknownAuthor"))
  const canonicalAuthorParam = getAuthorRouteParam(author)
  const basePath = `/blog/authors/${canonicalAuthorParam}`
  // An author has fewer posts in some locales, so a numbered page exists only in
  // the locales whose count reaches it.
  const pageCounts = await getBlogPageCounts({ pathname: basePath })

  const avatarUrl = author.avatar ? `${SITE_URL}${author.avatar}` : undefined

  const title = t("title", { name: authorName })
  const description = t("description", { name: authorName })

  return {
    title,
    description,
    alternates: buildPaginatedAlternates({
      pathname: getBlogCollectionPagePath({ pathname: basePath, page }),
      locale,
      availableLocales: getLocalesWithBlogPage({ pageCounts, page }),
      page,
    }),
    openGraph: {
      ...getOpenGraphLocales(locale),
      title,
      description,
      type: "profile",
      url: absoluteLocalizedUrl({ pathname: getBlogCollectionPagePath({ pathname: basePath, page }), locale }),
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
  const { locale, authorId: authorRouteParam, page: pageParam } = await params
  const page = requireBlogCollectionPage({ pathname: `/blog/authors/${authorRouteParam}`, pageParam, locale });
  const t = await getTranslator({ locale, namespace: "Blog.AuthorDetail" })
  const tCommon = await getTranslator({ locale, namespace: "Blog.Common" })
  // Ahead of the empty-blog redirect below on purpose: a malformed param must 404, not go home.
  const parsedAuthorId = parseAuthorIdFromRouteParam(authorRouteParam)

  if (!parsedAuthorId) {
    notFound()
  }

  const facetPage = await getBlogFacetPage({ locale, facet: { type: "author", authorId: parsedAuthorId } });

  if (!facetPage) {
    // An empty blog uses the same rule as the main list; a real unknown author 404s.
    if (!(await hasPublishedBlogPosts())) {
      redirect({ href: "/", locale });
    }
    notFound();
  }

  const author = facetPage.subject;
  const totalCount = facetPage.posts.length;
  const totalPages = Math.ceil(totalCount / BLOG_POSTS_PER_PAGE);
  const authorEntries = sliceBlogPage({ items: facetPage.posts, page });

  if (isBlogPageOutOfRange({ page, totalCount })) {
    notFound();
  }

  const authorName = getAuthorDisplayName(author, t("unknownAuthor"))
  const canonicalAuthorParam = getAuthorRouteParam(author)

  if (authorRouteParam !== canonicalAuthorParam) {
    redirect({ href: getBlogCollectionPagePath({ pathname: `/blog/authors/${canonicalAuthorParam}`, page }), locale })
  }

  const graph = await buildBlogAuthorGraph({ locale, author, page })

  return (
    <>
      <JsonLd graph={graph} />
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
                {tCommon("postCount", { count: totalCount })}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {authorEntries.map((entry) => (
            <BlogCard key={entry.id} locale={locale} entry={entry} showAuthor={false} />
          ))}
        </div>
        <BlogPaginationServer
          pathname={`/blog/authors/${canonicalAuthorParam}`}
          currentPage={page}
          totalPages={totalPages}
          locale={locale}
        />
      </div>
    </>
  )
}
