import "server-only"
import { getTranslator } from "@/i18n/translator";
import { Link, redirect } from "@/i18n/navigation"
import type { Metadata } from "next"
import { getBlogAuthors } from "@/lib/cms/blog-list-artifacts"
import { hasPublishedBlogPosts } from "@/lib/blog-visibility"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { MARKDOWN_DIRECTIVES } from "@/constants/markdown-directives"
import { getAuthorDisplayName, getAuthorRouteParam } from "@/utils/blog-author-url"
import { getInitials } from "@/utils/name-initials"
import { BlogBackLink } from "@/components/blog-back-link"
import { BlogEmptyState } from "@/components/blog-empty-state"
import { HairlineGrid } from "@/components/hairline-grid"
import { getOpenGraphLocales, LOCALES, type Locale } from "@/i18n/config"
import { buildAlternates } from "@/utils/i18n-metadata"
import { absoluteLocalizedUrl } from "@/utils/i18n-urls"
import { buildBlogAuthorsGraph } from "@/lib/seo/blog-json-ld"
import { JsonLd } from "@/lib/seo/json-ld"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslator({ locale, namespace: "Blog.Authors.meta" });
  const title = t("title");
  const description = t("description");

  return {
    title,
    description,
    // This listing page renders in every locale, so every locale gets an
    // hreflang entry.
    alternates: buildAlternates({ pathname: "/blog/authors", locale, availableLocales: LOCALES }),
    openGraph: {
      ...getOpenGraphLocales(locale),
      title,
      description,
      type: "website",
      url: absoluteLocalizedUrl({ pathname: "/blog/authors", locale }),
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
  const { locale } = await params
  const t = await getTranslator({ locale, namespace: "Blog.Authors" })
  const tAuthor = await getTranslator({ locale, namespace: "Blog.AuthorDetail" })
  const tCommon = await getTranslator({ locale, namespace: "Blog.Common" })
  const unknownAuthor = tAuthor("unknownAuthor")

  const { authors, hasPosts } = await getBlogAuthors(locale)

  // Empty only in this locale still renders the localized empty state; redirect
  // home only when the blog has no published posts at all.
  if (!hasPosts && !(await hasPublishedBlogPosts())) {
    redirect({ href: "/", locale })
  }

  const graph = await buildBlogAuthorsGraph({ locale, authors })

  return (
    <>
      <JsonLd graph={graph} />
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

        {authors.length === 0 ? (
          <BlogEmptyState message={t("empty")} />
        ) : (
          <HairlineGrid count={authors.length}>
            {authors.map((author) => (
              <Link
                key={author.id}
                href={`/blog/authors/${getAuthorRouteParam(author)}`}
                className="group relative block bg-card p-6 transition-colors hover:bg-accent/40"
              >
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-px scale-x-0 bg-edge transition-transform duration-300 group-hover:scale-x-100 motion-reduce:transition-none"
                />
                <div className="flex items-center gap-4">
                  {/* The name next to it is the author; the initials would only repeat it. */}
                  <Avatar
                    aria-hidden
                    data-markdown={MARKDOWN_DIRECTIVES.skip}
                    className="h-12 w-12 ring-1 ring-border"
                  >
                    {author.avatar && <AvatarImage src={author.avatar} alt={getAuthorDisplayName(author, unknownAuthor)} />}
                    <AvatarFallback>
                      {getInitials(getAuthorDisplayName(author, unknownAuthor))}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <h2 className="truncate font-display text-lg font-semibold text-foreground transition-colors group-hover:text-edge">
                      {getAuthorDisplayName(author, unknownAuthor)}
                    </h2>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {tCommon("postCount", { count: author.postCount })}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </HairlineGrid>
        )}
      </div>
    </>
  )
}
