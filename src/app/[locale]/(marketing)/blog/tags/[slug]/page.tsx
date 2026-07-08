import "server-only"
import { Link } from "@/i18n/navigation"
import { notFound, redirect } from "next/navigation"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { getCmsCollection } from "@/lib/cms/entry"
import { hasPublishedBlogPosts } from "@/lib/blog-visibility"
import { getCmsTags } from "@/lib/cms/tags"
import { BlogCard } from "@/components/blog-card"
import { CmsEntryTags } from "@/components/cms-entry-tags"
import type { CollectionPage, WithContext } from "schema-dts"
import { getCmsEntryDates } from "@/utils/cms-entry-dates"
import { LOCALES, type Locale } from "@/i18n/config"
import { buildAlternates } from "@/utils/i18n-metadata"

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
      title,
      description,
      type: "website",
      url: `/blog/tags/${slug}`,
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
  const { locale, slug } = await params

  // Get all tags (localized for this locale) to find the current one
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
    redirect("/")
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
      <div className="container mx-auto py-12">
      <div className="mb-12">
        <Link
          href="/blog/tags"
          className="text-sm text-muted-foreground hover:text-primary transition-all mb-4 inline-block"
        >
          {t("backToTags")}
        </Link>
        <h1 className="text-4xl font-bold mb-4">{tag.name}</h1>
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <CmsEntryTags
            tags={[{ tag }]}
            maxTags={1}
          />
          <span className="text-sm text-muted-foreground">
            {t("postCount", { count: blogEntries.length })}
          </span>
        </div>
        {tag.description && (
          <p className="text-xl text-muted-foreground">
            {tag.description}
          </p>
        )}
      </div>

      {blogEntries.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {blogEntries.map((entry) => (
            <BlogCard key={entry.id} entry={entry} showTags={false} />
          ))}
        </div>
      )}
    </div>
    </>
  )
}
