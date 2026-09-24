import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALES, type Locale } from "./config";

interface LocalePrefixMatch {
  locale: Locale;
  /** Path below the prefix. `/` when the prefix is the whole path. */
  pathname: string;
}

// The one prefix rule. Case-insensitive, so `/ES/blog` names `es` and the middleware can redirect
// it to its one spelling. The catalog is the only thing the exports below vary.
function matchPrefix({
  pathname,
  locales,
}: {
  pathname: string;
  locales: readonly Locale[];
}): LocalePrefixMatch | null {
  const lowered = pathname.toLowerCase();

  for (const locale of locales) {
    const prefix = `/${locale.toLowerCase()}`;

    if (lowered === prefix || lowered.startsWith(`${prefix}/`)) {
      return { locale, pathname: pathname.slice(prefix.length) || "/" };
    }
  }

  return null;
}

/**
 * The served locale prefix this path carries, or `null` when it carries none. With `I18N_ENABLED`
 * off a de-served prefix must miss here, or the request would resolve to a locale nobody serves.
 */
export function matchLocalePrefix(pathname: string): LocalePrefixMatch | null {
  return matchPrefix({ pathname, locales: ENABLED_LOCALES });
}

// `matchLocalePrefix`, with a bare path read as the default locale.
export function splitLocalePrefix(pathname: string): LocalePrefixMatch {
  return matchLocalePrefix(pathname) ?? { locale: DEFAULT_LOCALE, pathname };
}

// The bare path behind a prefix from the full LOCALES catalog, or `null` when there is none. The
// full catalog, so a de-served prefix is still a prefix to collapse or replace, never a page path.
export function stripLocalePrefix(pathname: string): string | null {
  return matchPrefix({ pathname, locales: LOCALES })?.pathname ?? null;
}
