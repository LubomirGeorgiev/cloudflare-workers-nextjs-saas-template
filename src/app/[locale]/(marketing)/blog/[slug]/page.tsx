import { notFound, redirect } from "next/navigation"
import { Link, redirect as redirectLocalized } from "@/i18n/navigation"
import { cache } from "react"
import { getTranslations } from "next-intl/server"
import { formatDate } from "@/utils/format-date"
import type { Metadata } from "next"
import type { Route } from "next"
import { getCmsEntryBySlug, getEntryLocales } from "@/lib/cms/entry"
import { hasPublishedBlogPosts } from "@/lib/blog-visibility"
import { resolveLocalizedEntry } from "@/lib/cms/resolve-localized-entry"
import { CmsEntryBody } from "@/components/cms-entry-body"
import { ContentTableOfContentsNav } from "@/components/content-table-of-contents-nav"
import { generateMetaDescription } from "@/lib/cms/extract-text-from-content"
import type { JSONContent } from "@tiptap/core"
import Image from "next/image"
import { SITE_NAME, SITE_URL } from "@/constants"
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config"
import { buildAlternates, noindexNonDefaultLocale } from "@/utils/i18n-metadata"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getInitials } from "@/utils/name-initials"
import { BlogBackLink } from "@/components/blog-back-link"
import { cn } from "@/lib/utils"
import { CmsEntryTags } from "@/components/cms-entry-tags"
import { localizeEntryTags } from "@/lib/cms/tags"
import type { BlogPosting, BreadcrumbList, WithContext } from "schema-dts"
import { BlogListPage, getBlogListPageMetadata } from "../_components/blog-list-page"
import { getBlogPagePath } from "@/lib/blog-routing"
import { getValidPageNumber } from "@/utils/get-valid-page-number"
import { getAuthorRouteParam } from "@/utils/blog-author-url"
import { getCmsEntryDates } from "@/utils/cms-entry-dates"
import { buildTableOfContentsTree } from "@/lib/cms/table-of-contents-tree"
import { extractTableOfContents } from "@/lib/cms/extract-table-of-contents"
import { buildCmsEntryMarkdownPath } from "@/lib/cms/cms-paths"

type BlogPostPageProps = {
  params: Promise<{
    locale: Locale
    slug: string
  }>
}

function blogSlugWithoutMdSuffix(slug: string): string | undefined {
  if (!slug.toLowerCase().endsWith(".md")) {
    return undefined
  }

  const base = slug.slice(0, -".md".length)
  return base || undefined
}

const getCachedBlogEntryBySlug = cache(async (slug: string, locale: Locale) => {
  return getCmsEntryBySlug({
    collectionSlug: "blog",
    slug,
    locale,
    includeRelations: { tags: true, createdByUser: true },
  })
})

// Resolves the active-locale post, falling back to the default-locale post
// under the active locale's URL (no redirect) when untranslated — redirecting
// to the unprefixed URL infinite-loops under `localeDetection: true`.
const getCachedResolvedBlogEntry = cache(async (slug: string, locale: Locale) => {
  return resolveLocalizedEntry({
    locale,
    defaultLocale: DEFAULT_LOCALE,
    getEntry: ({ locale: entryLocale }) => getCachedBlogEntryBySlug(slug, entryLocale),
  })
})

const getCachedBlogMarkdownEntryBySlug = cache(async (slug: string) => {
  return getCmsEntryBySlug({
    collectionSlug: "blog",
    slug,
  })
})

export async function generateMetadata({
  params,
}: BlogPostPageProps): Promise<Metadata> {
  const { locale, slug } = await params
  const tNotFound = await getTranslations({ locale, namespace: "Blog.PostNotFound" })

  const slugForMarkdown = blogSlugWithoutMdSuffix(slug)
  if (slugForMarkdown !== undefined) {
    const mdEntry = await getCachedBlogMarkdownEntryBySlug(slugForMarkdown)
    if (mdEntry) {
      redirect(
        buildCmsEntryMarkdownPath({
          collectionSlug: "blog",
          slug: slugForMarkdown,
        }) as Route
      )
    }

    const mdPageNumber = getValidPageNumber({ value: slugForMarkdown })
    if (mdPageNumber) {
      redirectLocalized({ href: getBlogPagePath({ page: mdPageNumber }), locale })
    }

    return {
      title: tNotFound("title"),
    }
  }

  const validPageNumber = getValidPageNumber({ value: slug })

  if (validPageNumber) {
    return getBlogListPageMetadata({ page: validPageNumber, locale })
  }

  const resolved = await getCachedResolvedBlogEntry(slug, locale)

  if (!resolved) {
    return {
      title: tNotFound("title"),
    }
  }

  const { entry, isFallback } = resolved

  const description = entry.seoDescription || generateMetaDescription(entry.content as JSONContent)
  const featuredImageUrl = entry.featuredImageUrl ? `${SITE_URL}${entry.featuredImageUrl}` : undefined
  const author = entry.createdByUser
  const authorName = author
    ? [author.firstName, author.lastName].filter(Boolean).join(' ') || author.email
    : undefined
  // A fallback render serves default-locale content, so localize tags to the
  // body's real language, not the URL's, keeping keywords consistent.
  const displayLocale = isFallback ? DEFAULT_LOCALE : locale
  const localizedTags = await localizeEntryTags(entry.tags, displayLocale)
  const tags = localizedTags.map(({ tag }) => tag.name)

  const { publishedDate, modifiedDate } = getCmsEntryDates({
    publishedAt: entry.publishedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  })

  const availableLocales = await getEntryLocales({ collectionSlug: "blog", slug })
  const validLocales = availableLocales.filter(isLocale)

  // A fallback render serves default-locale content under a non-default-locale
  // prefix (noindexed, mixed-language), so it canonicalizes to the real
  // default-locale URL; hreflang still lists only genuine translations.
  const alternates = isFallback
    ? buildAlternates({ pathname: `/blog/${slug}`, locale: DEFAULT_LOCALE, availableLocales: validLocales })
    : buildAlternates({ pathname: `/blog/${slug}`, locale, availableLocales: validLocales })

  return {
    title: entry.title,
    description: description || entry.title,
    ...(isFallback ? noindexNonDefaultLocale(locale) : {}),
    alternates,
    openGraph: {
      title: entry.title,
      description: description || entry.title,
      type: 'article',
      url: `/blog/${slug}`,
      publishedTime: publishedDate.toISOString(),
      modifiedTime: modifiedDate.toISOString(),
      ...(authorName && { authors: [authorName] }),
      ...(tags.length > 0 && { tags }),
      ...(featuredImageUrl && {
        images: [
          {
            url: featuredImageUrl,
            width: entry.featuredImage?.width || 1200,
            height: entry.featuredImage?.height || 630,
            alt: entry.featuredImage?.alt || entry.title,
          },
        ],
      }),
    },
    twitter: {
      card: 'summary_large_image',
      title: entry.title,
      description: description || entry.title,
      ...(featuredImageUrl && {
        images: [featuredImageUrl],
      }),
    },
  }
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { locale, slug } = await params
  const t = await getTranslations("Blog.Post")
  const tCrumb = await getTranslations("Breadcrumb")

  const slugForMarkdown = blogSlugWithoutMdSuffix(slug)
  if (slugForMarkdown !== undefined) {
    const mdEntry = await getCachedBlogMarkdownEntryBySlug(slugForMarkdown)
    if (mdEntry) {
      redirect(
        buildCmsEntryMarkdownPath({
          collectionSlug: "blog",
          slug: slugForMarkdown,
        }) as Route
      )
    }

    const mdPageNumber = getValidPageNumber({ value: slugForMarkdown })
    if (mdPageNumber) {
      redirectLocalized({ href: getBlogPagePath({ page: mdPageNumber }), locale })
    }

    if (!(await hasPublishedBlogPosts())) {
      redirect("/")
    }

    notFound()
  }

  const validPageNumber = getValidPageNumber({ value: slug })

  if (validPageNumber) {
    if (slug !== String(validPageNumber) || validPageNumber === 1) {
      redirectLocalized({ href: getBlogPagePath({ page: validPageNumber }), locale })
    }

    return <BlogListPage page={validPageNumber} locale={locale} />
  }

  const resolved = await getCachedResolvedBlogEntry(slug, locale)

  if (!resolved) {
    if (!(await hasPublishedBlogPosts())) {
      redirect("/")
    }

    notFound()
  }

  const { entry, isFallback } = resolved

  const author = entry.createdByUser
  const authorName = author
    ? [author.firstName, author.lastName].filter(Boolean).join(' ') || author.email || 'Unknown Author'
    : 'Unknown Author'

  // A fallback render serves default-locale content, so localize tags to the
  // body's real language, not the URL's.
  const displayLocale = isFallback ? DEFAULT_LOCALE : locale
  const localizedTags = await localizeEntryTags(entry.tags, displayLocale)

  const { publishedDate, modifiedDate } = getCmsEntryDates({
    publishedAt: entry.publishedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  })
  const tableOfContents = extractTableOfContents(entry.content as JSONContent)
  const tableOfContentsTree = buildTableOfContentsTree(tableOfContents)

  // JSON-LD structured data for Article
  const jsonLd: WithContext<BlogPosting> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: entry.title,
    // A fallback render serves the default-locale (English) body under a
    // non-default prefix, so advertise the body's real language, not the URL's.
    inLanguage: isFallback ? DEFAULT_LOCALE : locale,
    description: entry.seoDescription || generateMetaDescription(entry.content as JSONContent),
    url: `${SITE_URL}/blog/${entry.slug}`,
    datePublished: publishedDate.toISOString(),
    dateModified: modifiedDate.toISOString(),
    ...(entry.featuredImageUrl && {
      image: `${SITE_URL}${entry.featuredImageUrl}`,
    }),
    ...(author && {
      author: {
        "@type": "Person",
        name: authorName,
        url: `${SITE_URL}/blog/authors/${getAuthorRouteParam(author)}`,
        ...(author.avatar && {
          image: `${SITE_URL}${author.avatar}`,
        }),
      },
    }),
    ...(localizedTags.length > 0 && {
      keywords: localizedTags.map(({ tag }) => tag.name).join(", "),
    }),
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${SITE_URL}/blog/${entry.slug}`,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/favicon.ico`,
      },
    },
  }

  // Breadcrumb structured data
  const breadcrumbJsonLd: WithContext<BreadcrumbList> = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: tCrumb("home"),
        item: SITE_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: tCrumb("blog"),
        item: `${SITE_URL}/blog`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: entry.title,
        item: `${SITE_URL}/blog/${entry.slug}`,
      },
    ],
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <div className="mx-auto max-w-6xl py-12 sm:py-16">
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_260px]">
          <article className="min-w-0 max-w-3xl">
            <header className="mb-10">
              <BlogBackLink href="/blog" label={t("backToBlog")} />

              <h1 className="mt-5 text-balance font-display text-4xl font-semibold leading-[1.1] tracking-tight text-foreground sm:text-5xl">
                {entry.title}
              </h1>

              {/* Metadata section */}
              <div className="mt-7 flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  {author && (
                    <Link
                      href={`/blog/authors/${getAuthorRouteParam(author)}`}
                      className="group flex items-center gap-3"
                    >
                      <Avatar className="h-10 w-10">
                        {author.avatar && <AvatarImage src={author.avatar} alt={authorName} />}
                        <AvatarFallback>
                          {getInitials(authorName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium transition-colors group-hover:text-edge">
                        {authorName}
                      </span>
                    </Link>
                  )}

                  <div
                    className={cn(
                      "flex flex-col font-mono text-xs uppercase tracking-wide text-muted-foreground sm:flex-row sm:items-center sm:gap-2",
                      author && "border-l pl-3",
                    )}
                  >
                    <time dateTime={publishedDate.toISOString()}>
                      {formatDate(publishedDate)}
                    </time>
                    {modifiedDate.getTime() !== publishedDate.getTime() && (
                      <span>{t("updated", { date: formatDate(modifiedDate) })}</span>
                    )}
                  </div>
                </div>

                {/* Tags row */}
                {localizedTags.length > 0 && (
                  <div className="flex flex-wrap gap-2 border-t pt-4">
                    <CmsEntryTags
                      tags={localizedTags}
                      maxTags={Infinity}
                      variant="outline"
                      linkHref={(tag) => `/blog/tags/${tag.slug}`}
                    />
                  </div>
                )}
              </div>
            </header>

            {entry.featuredImageUrl && (
              <div className="relative mb-10 aspect-video w-full overflow-hidden rounded-xl border">
                <Image
                  src={entry.featuredImageUrl}
                  alt={entry.featuredImage?.alt || entry.title}
                  fill
                  className="object-cover"
                  priority
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 768px, 896px"
                />
              </div>
            )}

            <CmsEntryBody
              content={entry.content as JSONContent}
              className="blog-content"
              tableOfContents={tableOfContents}
            />
          </article>

          {tableOfContents.length > 0 && (
            <aside className="hidden xl:block">
              <div className="sticky top-10">
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-edge">
                  {t("onThisPage")}
                </p>
                <ContentTableOfContentsNav nodes={tableOfContentsTree} />
              </div>
            </aside>
          )}
        </div>
      </div>
    </>
  )
}
