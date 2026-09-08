import { type Locale } from "@/i18n/config";
import { splitLocalePrefix } from "@/i18n/locale-prefix";
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
