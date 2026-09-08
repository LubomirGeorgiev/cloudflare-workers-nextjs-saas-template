import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALES, type Locale } from "./config";

// The one match both public functions need, over whichever catalog the caller passes. A hit gives
// back the locale and the path below it; a bare path gives back `null`.
function matchLocalePrefix({
  pathname,
  locales,
}: {
  pathname: string;
  locales: readonly Locale[];
}): { locale: Locale; pathname: string } | null {
  for (const locale of locales) {
    if (pathname === `/${locale}`) {
      return { locale, pathname: "/" };
    }
    if (pathname.startsWith(`/${locale}/`)) {
      return { locale, pathname: pathname.slice(locale.length + 1) };
    }
  }

  return null;
}

// The bare path behind a locale-prefixed one, or `null` when the path carries no prefix. Checks the
// full LOCALES catalog, not just the enabled set, so paths for disabled locales are caught too.
export function stripLocalePrefix(pathname: string): string | null {
  return matchLocalePrefix({ pathname, locales: LOCALES })?.pathname ?? null;
}

// The locale the URL itself names, and the path below it. A bare path names the default locale.
// Follows the served set, not the catalog above: with `I18N_ENABLED` off a de-served prefix is no
// longer a locale prefix, so it must miss here rather than resolve to a page the router lost.
export function splitLocalePrefix(pathname: string): { locale: Locale; pathname: string } {
  return (
    matchLocalePrefix({ pathname, locales: ENABLED_LOCALES }) ?? {
      locale: DEFAULT_LOCALE,
      pathname,
    }
  );
}
