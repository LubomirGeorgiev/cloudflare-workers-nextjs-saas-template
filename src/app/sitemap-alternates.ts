import "server-only";

import { I18N_ENABLED } from "@/constants";
import { isLocale, LOCALES, type Locale } from "@/i18n/config";
import { absoluteLocalizedUrl } from "@/utils/i18n-urls";

// Builds the hreflang `alternates.languages` map (one absolute URL per locale)
// for entries translated and indexable in every locale — site root, /privacy,
// /terms. Blog/docs stay out while their `/es/*` pages are `noindex`.
export function localizedSitemapAlternates(pathname: string): Record<Locale, string> {
  return entryAlternates(pathname, LOCALES) as Record<Locale, string>;
}

// Like `localizedSitemapAlternates`, but scoped to the locales a CMS entry
// actually has a translated row for (`getEntryLocales`) — advertising an
// `/es/*` URL that 404s or falls back to English would be dishonest hreflang.
export function entryAlternates(
  pathname: string,
  locales: readonly string[],
): Partial<Record<Locale, string>> {
  const languages: Partial<Record<Locale, string>> = {};

  // Single-locale mode: no hreflang alternates to advertise.
  if (!I18N_ENABLED) {
    return languages;
  }

  for (const locale of locales) {
    if (!isLocale(locale)) {
      continue;
    }

    languages[locale] = absoluteLocalizedUrl({ pathname, locale });
  }

  return languages;
}
