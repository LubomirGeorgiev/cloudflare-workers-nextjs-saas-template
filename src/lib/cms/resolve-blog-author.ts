import "server-only";

import type { Locale } from "@/i18n/config";
import { parseAuthorIdFromRouteParam } from "@/utils/blog-author-url";

import { getCmsCollection } from "./entry";
import type { CmsCollectionListItem } from "./entry/types";

type BlogAuthor = NonNullable<CmsCollectionListItem["createdByUser"]>;

interface ResolvedBlogAuthor {
  author: BlogAuthor;
  entries: CmsCollectionListItem[];
}

// Blog entries carrying their author. `includeTags` is the author page's own need — its cards
// render tag pills — so the OG card, which only names the author, does not pay for that join.
// The relation set is part of the cache key, so it is spelled out rather than passed as `false`.
export function getBlogEntriesWithAuthors({
  locale,
  includeTags = false,
}: {
  locale: Locale;
  includeTags?: boolean;
}): Promise<CmsCollectionListItem[]> {
  return getCmsCollection({
    collectionSlug: "blog",
    includeRelations: includeTags ? { createdByUser: true, tags: true } : { createdByUser: true },
    locale,
  });
}

// The author behind a `/blog/authors/[authorId]` route param, with the entries they wrote. Kept out
// of the page so the page and its `opengraph-image` resolve one param the exact same way. Returns
// null for a malformed param or an author with no entries in this locale.
export function resolveBlogAuthor({
  entries,
  authorRouteParam,
}: {
  entries: CmsCollectionListItem[];
  authorRouteParam: string;
}): ResolvedBlogAuthor | null {
  const authorId = parseAuthorIdFromRouteParam(authorRouteParam);

  if (!authorId) {
    return null;
  }

  const authorEntries = entries.filter((entry) => entry.createdByUser?.id === authorId);
  const author = authorEntries[0]?.createdByUser;

  return author ? { author, entries: authorEntries } : null;
}
