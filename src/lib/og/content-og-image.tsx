import "server-only"

import type { ImageResponse } from "next/og"

import { CACHE_TAGS } from "@/constants/cache-tags"
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config"
import { getTranslator } from "@/i18n/translator"
import { getCmsEntryBySlug } from "@/lib/cms/entry"
import { generateMetaDescription } from "@/lib/cms/extract-text-from-content"
import { resolveCurrentDocsPage } from "@/lib/cms/resolve-current-docs-page"
import { resolveLocalizedEntry } from "@/lib/cms/resolve-localized-entry"
import { getBlogEntriesWithAuthors, resolveBlogAuthor } from "@/lib/cms/resolve-blog-author"
import { BLOG_COLLECTION_SLUG } from "@/lib/blog-routing"
import {
  BLOG_COLLECTION_CACHE_TAGS,
  blogEntryCacheTags,
  CMS_TAGS_CACHE_TAGS,
  DOCS_NAVIGATION_CACHE_TAGS,
} from "@/lib/cms/cms-section-cache-tags"
import { DOCS_SLUG } from "@/lib/cms/docs-config"
import { getCmsTags } from "@/lib/cms/tags"
import { getNavigationNodeDisplayTitle } from "@/types/cms-navigation"
import { getAuthorDisplayName } from "@/utils/blog-author-url"

import { renderOgImageWithLocalizedEyebrow, renderTranslatedOgImage } from "./translated-og-image"

// The edge stores each card, so its purge handles are the tags of the loader behind it. A fallback
// card carries them too, because a later publish can make the same URL resolve.

// Cards are rendered for whatever URL a crawler happens to hit, including slugs that no longer
// resolve. Every helper below therefore falls back to the section's own card rather than throwing —
// a 500 on `opengraph-image` costs the share preview entirely.

export async function renderBlogPostOgImage({
  locale,
  slug,
}: {
  locale: Locale
  slug: string
}): Promise<ImageResponse> {
  const cacheTags = blogEntryCacheTags(slug)
  // Also hit for `/blog/2` and other non-slug values the page maps to pagination — those simply
  // fail to resolve and fall through to the section card.
  const resolved = await resolveLocalizedEntry({
    locale,
    defaultLocale: DEFAULT_LOCALE,
    getEntry: ({ locale: entryLocale }) =>
      getCmsEntryBySlug({ collectionSlug: BLOG_COLLECTION_SLUG, slug, locale: entryLocale }),
  })

  if (!resolved) {
    return renderTranslatedOgImage({
      locale,
      namespace: "Blog.ListPage.meta",
      eyebrow: "blog",
      cacheTags,
    })
  }

  const { entry, isFallback } = resolved

  return renderOgImageWithLocalizedEyebrow({
    // A fallback render shows default-locale content, so the eyebrow follows the body's real
    // language — one card must not mix two languages.
    locale: isFallback ? DEFAULT_LOCALE : locale,
    eyebrow: "blog",
    title: entry.title,
    description: entry.seoDescription || generateMetaDescription(entry.content),
    cacheTags,
  })
}

export async function renderDocsOgImage({
  locale,
  slugParts,
}: {
  locale: Locale
  slugParts?: string[]
}): Promise<ImageResponse> {
  const result = await resolveCurrentDocsPage({ slugParts, locale })
  // A fallback page shows default-locale content, so the eyebrow follows the body's real
  // language — one card must not mix two languages.
  const displayLocale = result.type === "page" && result.isFallback ? DEFAULT_LOCALE : locale

  if (result.type === "page" && result.node.entry) {
    const { entry } = result.node

    return renderOgImageWithLocalizedEyebrow({
      locale: displayLocale,
      eyebrow: "docs",
      title: entry.title,
      description: entry.seoDescription || undefined,
      cacheTags: [
        ...DOCS_NAVIGATION_CACHE_TAGS,
        CACHE_TAGS.cmsEntry({ collectionSlug: DOCS_SLUG, slug: entry.slug }),
      ],
    })
  }

  if (result.type === "group") {
    return renderOgImageWithLocalizedEyebrow({
      locale: displayLocale,
      eyebrow: "docs",
      title: getNavigationNodeDisplayTitle(result.node),
      cacheTags: DOCS_NAVIGATION_CACHE_TAGS,
    })
  }

  // Redirects and unresolved slugs: the crawler still gets a branded docs card.
  return renderTranslatedOgImage({
    locale,
    namespace: "Client.Docs.meta",
    eyebrow: "docs",
    cacheTags: DOCS_NAVIGATION_CACHE_TAGS,
  })
}

export async function renderBlogTagOgImage({
  locale,
  slug,
}: {
  locale: Locale
  slug: string
}): Promise<ImageResponse> {
  // One `use cache: remote` entry per locale, already warm from the tag pages that share the key;
  // a per-slug read would add a second, colder key to fetch two fields.
  const tags = await getCmsTags({ locale })
  const tag = tags.find((candidate) => candidate.slug === slug)

  if (!tag) {
    return renderTranslatedOgImage({
      locale,
      namespace: "Blog.Tags.meta",
      eyebrow: "tags",
      cacheTags: CMS_TAGS_CACHE_TAGS,
    })
  }

  // The tag name carries the card on its own; the page's `meta.title` wraps it in prose that only
  // makes sense as a browser-tab title.
  return renderOgImageWithLocalizedEyebrow({
    locale,
    eyebrow: "tags",
    title: tag.name,
    description: tag.description || undefined,
    cacheTags: CMS_TAGS_CACHE_TAGS,
  })
}

export async function renderBlogAuthorOgImage({
  locale,
  authorRouteParam,
}: {
  locale: Locale
  authorRouteParam: string
}): Promise<ImageResponse> {
  // No by-id read: an author is a user who published here, so a user lookup would name any id a
  // crawler probes. This key is `use cache: remote` and already warm from `/blog/authors`, the page
  // that links to these routes.
  const entries = await getBlogEntriesWithAuthors({ locale })
  const resolved = resolveBlogAuthor({ entries, authorRouteParam })

  if (!resolved) {
    return renderTranslatedOgImage({
      locale,
      namespace: "Blog.Authors.meta",
      eyebrow: "authors",
      cacheTags: BLOG_COLLECTION_CACHE_TAGS,
    })
  }

  const tDetail = await getTranslator({ locale, namespace: "Blog.AuthorDetail" })

  return renderOgImageWithLocalizedEyebrow({
    locale,
    eyebrow: "authors",
    title: getAuthorDisplayName(resolved.author, tDetail("unknownAuthor")),
    cacheTags: BLOG_COLLECTION_CACHE_TAGS,
  })
}
