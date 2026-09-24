import {
  DEFAULT_LOCALE,
  isEnabledLocale,
  LOCALE_DETECTION,
  type Locale,
} from "./config";
import { matchLocalePrefix } from "./locale-prefix";

interface ResolvedLocale {
  locale: Locale;
  /** Path below the locale prefix. Equals the input when there is none. */
  pathname: string;
}

interface AcceptLanguageEntry {
  quality: number;
  tag: string;
}

// A `*` stays in the list: `isEnabledLocale` rejects it, so it can never win a negotiation.
function parseAcceptLanguage(header: string | null): AcceptLanguageEntry[] {
  if (!header) {
    return [];
  }

  return header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const quality = qParam ? Number.parseFloat(qParam.split("=")[1]) : 1;

      return { quality: Number.isNaN(quality) ? 0 : quality, tag: tag.trim().toLowerCase() };
    })
    .filter((entry) => entry.tag !== "")
    .sort((a, b) => b.quality - a.quality);
}

// The locale an `Accept-Language` header names, ranked by q-value and matched on the base tag. A
// missing header, or one that names no served locale, negotiates the default locale.
export function negotiateAcceptLanguage(header: string | null): Locale {
  for (const { tag } of parseAcceptLanguage(header)) {
    const base = tag.split("-")[0];

    if (isEnabledLocale(base)) {
      return base;
    }
  }

  return DEFAULT_LOCALE;
}

// The one resolver for "what locale is this request": URL prefix, cookie, `Accept-Language`,
// default. `src/proxy.ts` and the edge HTML cache both call it, so a stored page cannot reach a
// visitor the middleware would have redirected. It takes no user on purpose — a stored
// `preferredLocale` answers "what locale is this person", and reading it here costs a D1 query.
export function resolveRequestLocale({
  pathname,
  cookieLocale,
  acceptLanguage,
}: {
  pathname: string;
  cookieLocale: string | null | undefined;
  acceptLanguage: string | null;
}): ResolvedLocale {
  const prefix = matchLocalePrefix(pathname);

  if (prefix) {
    return prefix;
  }

  if (LOCALE_DETECTION) {
    if (isEnabledLocale(cookieLocale)) {
      return { locale: cookieLocale, pathname };
    }

    return { locale: negotiateAcceptLanguage(acceptLanguage), pathname };
  }

  return { locale: DEFAULT_LOCALE, pathname };
}
