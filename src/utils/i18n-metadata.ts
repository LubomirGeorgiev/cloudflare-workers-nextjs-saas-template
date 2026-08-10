import "server-only";

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { I18N_ENABLED, SITE_NAME } from "@/constants";
import { DEFAULT_LOCALE, getOpenGraphLocales, type Locale } from "@/i18n/config";
import { absoluteLocalizedUrl } from "@/utils/i18n-urls";

// Complete site-default OpenGraph object for a locale. Both the root layout and
// app/[locale]/layout.tsx must emit the FULL object: a child segment's `openGraph`
// replaces the parent's wholesale, so overriding with locale fields alone drops
// title/description/siteName. The [locale] layout re-emits it (rather than
// inheriting) because the root layout cannot see the [locale] param during
// static generation.
export async function buildSiteOpenGraph(locale: Locale): Promise<Metadata["openGraph"]> {
  const t = await getTranslations({ locale, namespace: "Landing.meta" });

  return {
    type: "website",
    ...getOpenGraphLocales(locale),
    url: absoluteLocalizedUrl({ pathname: "/", locale }),
    title: SITE_NAME,
    description: t("description"),
    siteName: SITE_NAME,
  };
}

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
// default-locale body under a non-default prefix (mixed-language), so the caller marks
// that render `noindex` and canonicalizes to the real default-locale URL.
export function noindexNonDefaultLocale(locale: Locale): Partial<Pick<Metadata, "robots">> {
  return locale !== DEFAULT_LOCALE ? { robots: { index: false, follow: true } } : {};
}
