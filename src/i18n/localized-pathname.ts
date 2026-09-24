import { DEFAULT_LOCALE, type Locale } from "./config";

interface LocalizedPathnameArgs {
  pathname: string;
  locale: Locale;
  /** Prefix even when the default locale would not be. The middleware rewrite needs it: the app routes live under `app/[locale]/`. */
  forcePrefix?: boolean;
}

// The single home for "which URL serves this path in this locale". As-needed prefixing: the default
// locale is served bare and every other locale is prefixed. The middleware, the navigation surface,
// the edge HTML cache, the sitemap, robots.txt, and the Markdown routes must all agree on it.
// Keep it free of `next/*`, so Workers integration tests and queue consumers can call it too.
export function localizedPathname({
  pathname,
  locale,
  forcePrefix = false,
}: LocalizedPathnameArgs): string {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;

  if (!forcePrefix && locale === DEFAULT_LOCALE) {
    return normalized;
  }

  return normalized === "/" ? `/${locale}` : `/${locale}${normalized}`;
}
