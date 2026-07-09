import "server-only"
import { Link } from "@/i18n/navigation"
import { redirect } from "next/navigation"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { getCmsTags } from "@/lib/cms/tags"
import { CmsEntryTags } from "@/components/cms-entry-tags"
import type { CollectionPage, WithContext } from "schema-dts"
import { LOCALES, type Locale } from "@/i18n/config"
import { buildAlternates } from "@/utils/i18n-metadata"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Blog.Tags.meta" });
  const title = t("title");
  const description = t("description");

  return {
    title,
    description,
    // This listing page renders in every locale, so every locale gets an
    // hreflang entry.
    alternates: buildAlternates({ pathname: "/blog/tags", locale, availableLocales: LOCALES }),
    openGraph: {
      title,
      description,
      type: "website",
      url: "/blog/tags",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function BlogTagsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const t = await getTranslations("Blog.Tags")
  const { locale } = await params
  const tags = await getCmsTags({ locale })

  // Only show tags that have entries
  const tagsWithEntries = tags.filter(tag => tag.entryCount > 0)

  if (tagsWithEntries.length === 0) {
    redirect("/")
  }

  // JSON-LD structured data for CollectionPage
  const jsonLd: WithContext<CollectionPage> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: t("meta.title"),
    inLanguage: locale,
    description: t("meta.description"),
    ...(tagsWithEntries.length > 0 && {
      mainEntity: {
        "@type": "ItemList",
        itemListElement: tagsWithEntries.map((tag, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "DefinedTerm",
            name: tag.name,
            ...(tag.description && { description: tag.description }),
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

      {tagsWithEntries.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {tagsWithEntries.map((tag) => (
            <Link
              key={tag.id}
              href={`/blog/tags/${tag.slug}`}
              className="group block"
            >
              <div className="h-full border rounded-lg p-6 transition-all hover:shadow-lg hover:border-primary">
                <div className="flex items-center justify-between mb-3">
                  <CmsEntryTags tags={[{ tag }]} maxTags={1} />
                  <span className="text-sm text-muted-foreground">
                    {t("postCount", { count: tag.entryCount })}
                  </span>
                </div>
                {tag.description && (
                  <p className="text-sm text-muted-foreground">
                    {tag.description}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
    </>
  )
}
