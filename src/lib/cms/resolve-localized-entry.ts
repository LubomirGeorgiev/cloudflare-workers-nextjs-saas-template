import "server-only";

interface ResolveLocalizedEntryParams<TEntry, TLocale extends string> {
  // The visitor's active locale (from the `/[locale]/...` route param).
  locale: TLocale;
  // The template's default locale — used as the fallback when `locale` has no entry.
  defaultLocale: TLocale;
  // Looks up the entry for a given locale. Called once for `locale`, and again
  // for `defaultLocale` only if that first call returns a falsy result and
  // `locale !== defaultLocale`.
  getEntry: (params: { locale: TLocale }) => Promise<TEntry | null | undefined>;
}

interface ResolvedLocalizedEntry<TEntry> {
  entry: TEntry;
  // True when `entry` fell back to `defaultLocale` (no translation for `locale`).
  // Callers render it under the active prefix (no redirect) and noindex +
  // canonicalize to the default-locale URL instead of advertising a translation.
  isFallback: boolean;
}

// Resolves a CMS entry for the active locale, falling back to the default-locale
// entry (translation groups share a slug) instead of redirecting — redirecting an
// untranslated page to the unprefixed URL infinite-loops under `localeDetection`.
export async function resolveLocalizedEntry<TEntry, TLocale extends string>({
  locale,
  defaultLocale,
  getEntry,
}: ResolveLocalizedEntryParams<TEntry, TLocale>): Promise<ResolvedLocalizedEntry<TEntry> | null> {
  const activeEntry = await getEntry({ locale });

  if (activeEntry) {
    return { entry: activeEntry, isFallback: false };
  }

  if (locale === defaultLocale) {
    return null;
  }

  const defaultEntry = await getEntry({ locale: defaultLocale });

  if (!defaultEntry) {
    return null;
  }

  return { entry: defaultEntry, isFallback: true };
}
