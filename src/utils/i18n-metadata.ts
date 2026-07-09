import "server-only";

import type { Metadata } from "next";

import { I18N_ENABLED } from "@/constants";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { absoluteLocalizedUrl } from "@/utils/i18n-urls";

interface BuildAlternatesOptions {
  // Locale-agnostic pathname (e.g. "/privacy"), as accepted by `getPathname`.
  pathname: string;
  // The locale the page is currently rendering for; becomes the self-canonical.
  locale: Locale;
  // Every locale that should get an hreflang entry — normally all of `LOCALES`.
  availableLocales: readonly Locale[];
}

// Builds per-locale self-canonical + hreflang alternates for a translated page:
// each locale canonicalizes to itself, and `languages` advertises every translation
// plus `x-default` for locale-less crawlers, per Google's i18n guidance.
export function buildAlternates({
  pathname,
  locale,
  availableLocales,
}: BuildAlternatesOptions): Metadata["alternates"] {
  const canonical = absoluteLocalizedUrl({ pathname, locale });

  // Single-locale mode: emit a self-canonical but no hreflang — advertising
  // language alternates that don't exist would be dishonest.
  if (!I18N_ENABLED) {
    return { canonical };
  }

  const languages: Record<string, string> = {};

  for (const availableLocale of availableLocales) {
    languages[availableLocale] = absoluteLocalizedUrl({ pathname, locale: availableLocale });
  }
  languages["x-default"] = absoluteLocalizedUrl({ pathname, locale: DEFAULT_LOCALE });

  return {
    canonical,
    languages,
  };
}

// Fallback for an entry that exists only in the default locale: it serves the
// English body under a non-default prefix (mixed-language), so the caller marks
// that render `noindex` and canonicalizes to the real default-locale URL.
export function noindexNonDefaultLocale(locale: Locale): Partial<Pick<Metadata, "robots">> {
  return locale !== DEFAULT_LOCALE ? { robots: { index: false, follow: true } } : {};
}
