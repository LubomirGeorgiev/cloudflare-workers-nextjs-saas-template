import "server-only";

import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { BLOG_POSTS_PER_PAGE } from "@/constants";
import { ENABLED_LOCALES, type Locale } from "@/i18n/config";
import { getBlogCollectionPagePath } from "@/lib/blog-routing";
import { getValidPageNumber } from "@/utils/get-valid-page-number";

// Named `require*` because it does not always return: a malformed page param
// 404s and a non-canonical one redirects.
export function requireBlogCollectionPage({ pathname, pageParam, locale }: {
  pathname: string;
  pageParam: string | undefined;
  locale: Locale;
}): number {
  const page = getValidPageNumber({ value: pageParam ?? "1" });
  if (!page) {
    notFound();
  }
  if (pageParam && (page === 1 || pageParam !== String(page))) {
    redirect({ href: getBlogCollectionPagePath({ pathname, page }), locale });
  }
  return page;
}

// The single overflow rule for every blog list: page one always renders, even
// with zero posts, and only a numbered page past the last one is a 404.
export function isBlogPageOutOfRange({ page, totalCount, pageSize = BLOG_POSTS_PER_PAGE }: {
  page: number;
  totalCount: number;
  pageSize?: number;
}): boolean {
  return page > 1 && page > Math.ceil(totalCount / pageSize);
}

// The locales that really serve a given page number, for hreflang and the sitemap.
// Page one renders in every locale, even one with no posts; a numbered page needs
// that locale's own post count to reach it.
export function getLocalesWithBlogPage({ pageCounts, page }: {
  pageCounts: Partial<Record<Locale, number>>;
  page: number;
}): Locale[] {
  return ENABLED_LOCALES.filter((locale) => page <= 1 || (pageCounts[locale] ?? 0) >= page);
}

export function sliceBlogPage<TItem>({ items, page, pageSize = BLOG_POSTS_PER_PAGE }: {
  items: readonly TItem[];
  page: number;
  pageSize?: number;
}): TItem[] {
  const offset = (page - 1) * pageSize;
  return items.slice(offset, offset + pageSize);
}
