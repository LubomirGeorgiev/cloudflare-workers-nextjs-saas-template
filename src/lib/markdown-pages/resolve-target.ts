import { DEFAULT_LOCALE, ENABLED_LOCALES, type Locale } from "@/i18n/config";
import { INDEXED_DOCS_ROUTES } from "@/constants/docs-routes";
import {
  BLOG_LISTING_ROUTES,
  DYNAMIC_BLOG_PAGE_PATTERNS,
  STATIC_PUBLIC_ROUTES,
} from "@/constants/public-routes";

import { localizedPagePathname, parseMarkdownPagePath } from "./page-paths";

const PUBLIC_PAGE_PATHS = new Set<string>([
  ...STATIC_PUBLIC_ROUTES.map(({ pathname }) => pathname),
  ...BLOG_LISTING_ROUTES.map(({ pathname }) => pathname),
  ...INDEXED_DOCS_ROUTES.map(({ pathname }) => pathname),
]);

export type MdRequestTarget =
  | { type: "cms"; collection: "blog" | "docs"; locale: Locale; path: string }
  | { type: "page"; pathname: string };

// Routing follows the served set: with `I18N_ENABLED` off, a de-served prefix must miss here rather
// than send a render at a page the router no longer has.
function splitLocalePrefix(pathname: string): { locale: Locale; pathname: string } {
  for (const locale of ENABLED_LOCALES) {
    if (pathname === `/${locale}`) {
      return { locale, pathname: "/" };
    }

    if (pathname.startsWith(`/${locale}/`)) {
      return { locale, pathname: pathname.slice(locale.length + 1) };
    }
  }

  return { locale: DEFAULT_LOCALE, pathname };
}

export function resolveMdRequestTarget(pathname: string): MdRequestTarget | null {
  const localized = splitLocalePrefix(pathname);
  const pagePath = parseMarkdownPagePath(localized.pathname);
  if (pagePath === null) {
    return null;
  }

  // The allowlist wins first: it already holds every app route under /docs/, so a CMS lookup for
  // one of them could never find an entry.
  if (PUBLIC_PAGE_PATHS.has(pagePath)) {
    return {
      type: "page",
      pathname: localizedPagePathname({ locale: localized.locale, pathname: pagePath }),
    };
  }

  if (DYNAMIC_BLOG_PAGE_PATTERNS.some((pattern) => pattern.test(pagePath))) {
    return {
      type: "page",
      pathname: localizedPagePathname({ locale: localized.locale, pathname: pagePath }),
    };
  }

  if (pagePath.startsWith("/docs/")) {
    return {
      type: "cms",
      collection: "docs",
      locale: localized.locale,
      path: pagePath.slice("/docs/".length),
    };
  }

  const blogMatch = /^\/blog\/([^/]+)$/.exec(pagePath);

  return blogMatch
    ? {
        type: "cms",
        collection: "blog",
        locale: localized.locale,
        path: blogMatch[1]!,
      }
    : null;
}
