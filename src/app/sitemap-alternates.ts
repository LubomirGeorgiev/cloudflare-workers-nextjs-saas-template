import "server-only";

import { I18N_ENABLED } from "@/constants";
import { DEFAULT_LOCALE, isLocale, LOCALES } from "@/i18n/config";
import { absoluteLocalizedUrl } from "@/utils/i18n-urls";

// Builds the hreflang `alternates.languages` map (one absolute URL per locale,
// plus `x-default`) for routes translated and indexable in every locale — the
// site root, /privacy, /terms, and the blog listing/tag/author pages, which
// render localized chrome in every locale.
export function localizedSitemapAlternates(pathname: string): Record<string, string> {
  return entryAlternates(pathname, LOCALES);
}

// Like `localizedSitemapAlternates`, but scoped to the locales a CMS entry
// actually has a translated row for (`getEntryLocales`) — advertising an
// `/es/*` URL that 404s or falls back to English would be dishonest hreflang.
// Mirrors the page-level `buildAlternates` output (including `x-default`) so the
// sitemap and on-page `<link rel="alternate">` tags agree.
export function entryAlternates(
  pathname: string,
  locales: readonly string[],
): Record<string, string> {
  const languages: Record<string, string> = {};

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

  // Advertise `x-default` → default-locale URL for locale-less crawlers, matching
  // `buildAlternates`. Only when a real alternate exists, so single-locale entries
  // stay a bare canonical.
  if (Object.keys(languages).length > 0) {
    languages["x-default"] = absoluteLocalizedUrl({ pathname, locale: DEFAULT_LOCALE });
  }

  return languages;
}
