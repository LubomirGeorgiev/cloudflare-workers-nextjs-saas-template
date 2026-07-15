import "server-only"
import { notFound } from "next/navigation"
import { redirect } from "@/i18n/navigation"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { getCmsCollection } from "@/lib/cms/entry"
import { hasPublishedBlogPosts } from "@/lib/blog-visibility"
import { getCmsTags } from "@/lib/cms/tags"
import { BlogCard } from "@/components/blog-card"
import { BlogBackLink } from "@/components/blog-back-link"
import { BlogEmptyState } from "@/components/blog-empty-state"
import type { CollectionPage, WithContext } from "schema-dts"
import { getCmsEntryDates } from "@/utils/cms-entry-dates"
import { getOpenGraphLocales, LOCALES, type Locale } from "@/i18n/config"
import { buildAlternates } from "@/utils/i18n-metadata"
import { absoluteLocalizedUrl } from "@/utils/i18n-urls"

type TagPageProps = {
  params: Promise<{
    locale: Locale
    slug: string
  }>
}

export async function generateMetadata({
  params,
}: TagPageProps): Promise<Metadata> {
  const { locale, slug } = await params
  const tMeta = await getTranslations({ locale, namespace: "Blog.TagDetail.meta" })
  const tags = await getCmsTags({ locale })
  const tag = tags.find(t => t.slug === slug)

  if (!tag) {
    return {
      title: tMeta("notFound"),
    }
  }

  const title = tMeta("title", { name: tag.name })
  const description = tag.description || tMeta("description", { name: tag.name })

  return {
    title,
    description,
    // This listing page renders in every locale, so every locale gets an
    // hreflang entry.
    alternates: buildAlternates({ pathname: `/blog/tags/${slug}`, locale, availableLocales: LOCALES }),
    openGraph: {
      ...getOpenGraphLocales(locale),
      title,
      description,
      type: "website",
      url: absoluteLocalizedUrl({ pathname: `/blog/tags/${slug}`, locale }),
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  }
}

export default async function TagPage({ params }: TagPageProps) {
  const t = await getTranslations("Blog.TagDetail")
  const tCommon = await getTranslations("Blog.Common")
  const { locale, slug } = await params

  const tags = await getCmsTags({ locale })
  const tag = tags.find(t => t.slug === slug)

  if (!tag) {
    notFound()
  }

  const allBlogEntries = await getCmsCollection({
    collectionSlug: 'blog',
    includeRelations: { tags: true, createdByUser: true },
    locale,
  })

  // Empty only in this locale still renders the localized empty state below;
  // redirect home only when the blog has no published posts at all.
  if (allBlogEntries.length === 0 && !(await hasPublishedBlogPosts())) {
    redirect({ href: "/", locale })
  }

  const blogEntries = allBlogEntries.filter(entry =>
    entry.tags?.some(entryTag => entryTag.tag.id === tag.id)
  )

  // JSON-LD structured data for CollectionPage
  const jsonLd: WithContext<CollectionPage> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: t("meta.title", { name: tag.name }),
    inLanguage: locale,
    description: tag.description || t("meta.description", { name: tag.name }),
    ...(blogEntries.length > 0 && {
      mainEntity: {
        "@type": "ItemList",
        itemListElement: blogEntries.map((entry, index) => {
          const { publishedDate, modifiedDate } = getCmsEntryDates({
            publishedAt: entry.publishedAt,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
          })

          return {
            "@type": "ListItem",
            position: index + 1,
            item: {
              "@type": "BlogPosting",
              headline: entry.title,
              datePublished: publishedDate.toISOString(),
              dateModified: modifiedDate.toISOString(),
            },
          }
        }),
      },
    }),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
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
              {tCommon("postCount", { count: blogEntries.length })}
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
              <BlogCard key={entry.id} entry={entry} showTags={false} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
