import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from "./config";

interface AcceptLanguageEntry {
  quality: number;
  tag: string;
}

// The one parser both readers below share, so a header is split once. A `*` stays in the list:
// only `resolveLocaleAsProxyWould` cares about it, and it judges the tags itself.
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

function matchRankedLocale(ranked: AcceptLanguageEntry[]): Locale | undefined {
  for (const { tag } of ranked) {
    const base = tag.split("-")[0];

    if (isSupportedLocale(base)) {
      return base;
    }
  }

  return undefined;
}

// Pick the best supported locale from an Accept-Language header, honoring the client's
// quality-value ordering (e.g. "es-ES,es;q=0.9,en;q=0.8"). It compares the base language only,
// so a regional tag such as "es-ES" matches "es".
export function matchAcceptLanguage(header: string | null): Locale | undefined {
  return matchRankedLocale(parseAcceptLanguage(header));
}

/**
 * The locale `src/proxy.ts` negotiates from the header, for code that runs before the proxy does.
 * A missing, blank, or wildcard header negotiates nothing; any other header lands on a served
 * locale, the default one when no tag matches. Only the cookie sync needs that difference, so
 * `matchAcceptLanguage` keeps returning `undefined` for both.
 */
export function resolveLocaleAsProxyWould(header: string | null): Locale | undefined {
  const ranked = parseAcceptLanguage(header);

  if (!ranked.some(({ tag }) => tag !== "*")) {
    return undefined;
  }

  return matchRankedLocale(ranked) ?? DEFAULT_LOCALE;
}
