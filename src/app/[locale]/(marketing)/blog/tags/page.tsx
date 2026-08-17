import "server-only"
import { getTranslator } from "@/i18n/translator";
import { Link, redirect } from "@/i18n/navigation"
import type { Metadata } from "next"
import { getCmsTags } from "@/lib/cms/tags"
import { BlogBackLink } from "@/components/blog-back-link"
import { BlogEmptyState } from "@/components/blog-empty-state"
import { HairlineGrid } from "@/components/hairline-grid"
import type { CollectionPage, WithContext } from "schema-dts"
import { getOpenGraphLocales, LOCALES, type Locale } from "@/i18n/config"
import { buildAlternates } from "@/utils/i18n-metadata"
import { absoluteLocalizedUrl } from "@/utils/i18n-urls"

// Cached for an hour — see docs/page-caching.md.
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslator({ locale, namespace: "Blog.Tags.meta" });
  const title = t("title");
  const description = t("description");

  return {
    title,
    description,
    // This listing page renders in every locale, so every locale gets an
    // hreflang entry.
    alternates: buildAlternates({ pathname: "/blog/tags", locale, availableLocales: LOCALES }),
    openGraph: {
      ...getOpenGraphLocales(locale),
      title,
      description,
      type: "website",
      url: absoluteLocalizedUrl({ pathname: "/blog/tags", locale }),
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
  const { locale } = await params
  const t = await getTranslator({ locale, namespace: "Blog.Tags" })
  const tCommon = await getTranslator({ locale, namespace: "Blog.Common" })
  const tags = await getCmsTags({ locale })

  // Only show tags that have entries, most-published topics first
  const tagsWithEntries = tags
    .filter(tag => tag.entryCount > 0)
    .sort((a, b) => b.entryCount - a.entryCount || a.name.localeCompare(b.name, locale))

  if (tagsWithEntries.length === 0) {
    redirect({ href: "/", locale })
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
      <div className="mx-auto max-w-7xl py-12 sm:py-16">
        <div className="mb-12">
          <BlogBackLink href="/blog" label={t("backToBlog")} />
          <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
            {t("description")}
          </p>
        </div>

        {tagsWithEntries.length === 0 ? (
          <BlogEmptyState message={t("empty")} />
        ) : (
          <HairlineGrid count={tagsWithEntries.length}>
            {tagsWithEntries.map((tag) => (
              <Link
                key={tag.id}
                href={`/blog/tags/${tag.slug}`}
                className="group relative block bg-card p-6 transition-colors hover:bg-accent/40"
              >
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-px scale-x-0 bg-edge transition-transform duration-300 group-hover:scale-x-100 motion-reduce:transition-none"
                />
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {/* The dot carries each tag's CMS-assigned color, matching its badges elsewhere. */}
                    {/* The ring keeps dots whose CMS color matches the card background visible. */}
                    {tag.color && (
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-foreground/20"
                        style={{ backgroundColor: tag.color }}
                      />
                    )}
                    <h2 className="truncate font-display text-lg font-semibold text-foreground transition-colors group-hover:text-edge">
                      {tag.name}
                    </h2>
                  </div>
                  <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {tCommon("postCount", { count: tag.entryCount })}
                  </span>
                </div>
                {tag.description && (
                  <p className="mt-2.5 line-clamp-2 text-sm leading-6 text-muted-foreground">
                    {tag.description}
                  </p>
                )}
              </Link>
            ))}
          </HairlineGrid>
        )}
      </div>
    </>
  )
}
