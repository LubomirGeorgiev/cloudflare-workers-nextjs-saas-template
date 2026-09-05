import "server-only";

import { BLOG_POSTS_PER_PAGE } from "@/constants";
import { ENABLED_LOCALES, type Locale } from "@/i18n/config";
import { BLOG_BASE_PATH } from "@/lib/blog-routing";
import { getBlogFacetPageCounts } from "@/lib/cms/blog-facet-pages";
import { getCmsCollection, type CmsCollectionListItem } from "@/lib/cms/entry";
import { getCmsTags } from "@/lib/cms/tags";
import { CACHE_TAGS, setCacheScope } from "@/utils/cache";

type BlogAuthor = NonNullable<CmsCollectionListItem["createdByUser"]>;
type BlogTag = Awaited<ReturnType<typeof getCmsTags>>[number];

interface BlogAuthorSummary extends BlogAuthor {
  postCount: number;
}

type BlogFacet = { type: "author"; authorId: string } | { type: "tag"; slug: string };

type BlogFacetSubject<TFacet extends BlogFacet> = TFacet extends { type: "author" } ? BlogAuthor : BlogTag;

interface BlogFacetPage<TFacet extends BlogFacet> {
  // The author or the tag the facet addresses.
  subject: BlogFacetSubject<TFacet>;
  // The blog has entries in this locale, even when this facet has none.
  hasPosts: boolean;
  posts: CmsCollectionListItem[];
}

export async function getBlogAuthors(locale: Locale) {
  "use cache: remote";
  setCacheScope({ tags: [CACHE_TAGS.cmsCollection("blog")], ttl: "8 hours" });
  const entries = await getCmsCollection({
    collectionSlug: "blog",
    includeRelations: { createdByUser: true },
    locale,
  });
  const authorsById = new Map<string, BlogAuthorSummary>();
  for (const entry of entries) {
    const author = entry.createdByUser;
    if (!author) {
      continue;
    }
    const existing = authorsById.get(author.id);
    if (existing) {
      existing.postCount++;
    } else {
      authorsById.set(author.id, { ...author, postCount: 1 });
    }
  }
  return {
    hasPosts: entries.length > 0,
    authors: Array.from(authorsById.values()).sort((a, b) => b.postCount - a.postCount),
  };
}

// Cached per facet, never per page: the whole collection is read and filtered in
// memory, so a page number in the key would repeat that read for every page.
export async function getBlogFacetPage<TFacet extends BlogFacet>({ locale, facet }: {
  locale: Locale;
  facet: TFacet;
}): Promise<BlogFacetPage<TFacet> | null> {
  "use cache: remote";
  setCacheScope({
    // The tag facet resolves its slug through the tag list, so it also drops when a tag changes.
    tags: facet.type === "tag"
      ? [CACHE_TAGS.cmsCollection("blog"), CACHE_TAGS.CMS_TAGS]
      : [CACHE_TAGS.cmsCollection("blog")],
    ttl: "8 hours",
  });

  if (facet.type === "tag") {
    const tags = await getCmsTags({ locale });
    const tag = tags.find((candidate) => candidate.slug === facet.slug);
    if (!tag) {
      return null;
    }
    const entries = await getBlogEntries(locale);
    return {
      subject: tag as BlogFacetSubject<TFacet>,
      hasPosts: entries.length > 0,
      posts: entries.filter((entry) => entry.tags?.some((entryTag) => entryTag.tag.id === tag.id)),
    };
  }

  const entries = await getBlogEntries(locale);
  const posts = entries.filter((entry) => entry.createdByUser?.id === facet.authorId);
  const author = posts[0]?.createdByUser;
  if (!author) {
    return null;
  }
  return {
    subject: author as BlogFacetSubject<TFacet>,
    hasPosts: entries.length > 0,
    posts,
  };
}

// How many pages each blog list path holds in one locale, keyed by the locale-agnostic
// base pathname. One cached read per locale, never one per facet: the whole collection
// is read once and every facet counted from it.
export async function getBlogPageCountsByPath(locale: Locale): Promise<Record<string, number>> {
  "use cache: remote";
  // Facet paths carry the tag slug, so a tag change moves them the same way it moves a facet page.
  setCacheScope({ tags: [CACHE_TAGS.cmsCollection("blog"), CACHE_TAGS.CMS_TAGS], ttl: "8 hours" });

  const entries = await getBlogEntries(locale);

  return {
    [BLOG_BASE_PATH]: Math.ceil(entries.length / BLOG_POSTS_PER_PAGE),
    ...Object.fromEntries(getBlogFacetPageCounts(entries)),
  };
}

// How many pages one blog list path holds in every served locale. A locale with fewer
// posts has fewer pages, so callers advertise a numbered page only where it exists.
export async function getBlogPageCounts({ pathname }: {
  pathname: string;
}): Promise<Partial<Record<Locale, number>>> {
  const countsByLocale = await Promise.all(
    ENABLED_LOCALES.map((locale) => getBlogPageCountsByPath(locale)),
  );

  return Object.fromEntries(
    ENABLED_LOCALES.map((locale, index) => [locale, countsByLocale[index]?.[pathname] ?? 0]),
  );
}

function getBlogEntries(locale: Locale) {
  return getCmsCollection({
    collectionSlug: "blog",
    includeRelations: { tags: true, createdByUser: true },
    locale,
  });
}
