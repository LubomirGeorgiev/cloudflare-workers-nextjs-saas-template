import { SITE_URL } from "@/constants";
import { DEFAULT_LOCALE, ENABLED_LOCALES, type Locale } from "@/i18n/config";

const MARKDOWN_EXTENSION = ".md";

/** The index segment, because neither a bare `/.md` nor a locale root `/es.md` is a usable URL. */
const INDEX_PAGE_SEGMENT = "/index";

// A locale root is a directory of pages, not a page: `/es.md` names nothing the router serves, so
// both directions use the `/es/index.md` form the site root already uses.
function isLocaleRootPathname(pathname: string): boolean {
  return ENABLED_LOCALES.some((locale) => pathname === `/${locale}`);
}

interface MarkdownPagePathParams {
  pathname: string;
  download?: boolean;
}

/** Forward rule: page path to `.md` path. `parseMarkdownPagePath` is the inverse. */
export function buildMarkdownPagePath({
  pathname,
  download = false,
}: MarkdownPagePathParams): string {
  const trimmed = pathname.replace(/\/+$/, "");
  const markdownPath =
    trimmed && !isLocaleRootPathname(trimmed)
      ? `${trimmed}${MARKDOWN_EXTENSION}`
      : `${trimmed}${INDEX_PAGE_SEGMENT}${MARKDOWN_EXTENSION}`;

  return download ? `${markdownPath}?download` : markdownPath;
}

export function buildAbsoluteMarkdownPageUrl(params: MarkdownPagePathParams): string {
  return `${SITE_URL}${buildMarkdownPagePath(params)}`;
}

export function buildAbsoluteSourcePageUrl({ pathname }: { pathname: string }): string {
  const normalized = pathname === "/" ? "" : pathname;
  return `${SITE_URL}${normalized}`;
}

// The locale variant of a page path, as `resolveMdRequestTarget` builds it and as the page
// Markdown cache key therefore holds it. The default locale keeps the bare path.
export function localizedPagePathname({
  locale,
  pathname,
}: {
  locale: Locale;
  pathname: string;
}): string {
  if (locale === DEFAULT_LOCALE) {
    return pathname;
  }

  return pathname === "/" ? `/${locale}` : `/${locale}${pathname}`;
}

/** Inverse rule: `.md` path to page path, or `null` when the path is not a Markdown path. */
export function parseMarkdownPagePath(markdownPath: string): string | null {
  if (!markdownPath.toLowerCase().endsWith(MARKDOWN_EXTENSION)) {
    return null;
  }

  const pagePath = markdownPath.slice(0, -MARKDOWN_EXTENSION.length) || "/";

  if (!pagePath.endsWith(INDEX_PAGE_SEGMENT)) {
    return pagePath;
  }

  const parent = pagePath.slice(0, -INDEX_PAGE_SEGMENT.length);
  if (parent === "") {
    return "/";
  }

  return isLocaleRootPathname(parent) ? parent : pagePath;
}
