// Central i18n configuration. Downstream template users add new locales here
// (with a matching `messages/<locale>.json`); the request config, locale
// helpers, and switcher UI all derive from these values.

import { I18N_ENABLED } from "@/constants";

export const LOCALES = ["en", "es"] as const;

export type Locale = (typeof LOCALES)[number];

// `cms_entry.locale` is a plain string column, so a de-served or legacy value can
// reach code that types locales as `Locale`. Guard raw DB/input strings with this
// instead of casting, so unknown locales are dropped rather than trusted.
export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export const DEFAULT_LOCALE: Locale = "en";

// The locales actually served. `LOCALES` still types the full catalog, but
// routing, static params, the switcher, hreflang alternates, and sitemaps all
// derive from this narrowed set — so flipping `I18N_ENABLED` to `false` collapses
// the site to a single (default) locale everywhere at once.
export const ENABLED_LOCALES: readonly Locale[] = I18N_ENABLED
  ? LOCALES
  : [DEFAULT_LOCALE];

// Cookie that persists the user's chosen locale. Keep routing and server actions
// pointed at this shared name so next-intl reads the same preference we write.
export const LOCALE_COOKIE_NAME = "selected_locale";

// One year, in seconds — the locale preference should outlive a session.
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Human-readable labels for the locale switcher. Keep in sync with LOCALES.
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
};

// OpenGraph locale codes per app locale. Keep in sync with LOCALES.
export const LOCALE_OG_MAP: Record<Locale, string> = {
  en: "en_US",
  es: "es_ES",
};
