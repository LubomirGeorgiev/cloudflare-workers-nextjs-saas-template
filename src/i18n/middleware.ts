import type { Locale } from "./config";
import { localizedPathname } from "./localized-pathname";
import { resolveRequestLocale } from "./resolve-locale";

// Pure on purpose: `src/proxy.ts` is evaluated in the rsc environment, so nothing here may reach
// `next/*` or React's `cache()`. The adapter turns a decision into a `NextResponse`. It only reads
// the locale cookie: only an explicit choice writes it, and `./locale-cookie.ts` names the writers.

export interface LocaleRouteRequest {
  pathname: string;
  /** Leading `?` included, exactly as `URL.search` gives it. */
  search: string;
  cookieLocale: string | null;
  acceptLanguage: string | null;
}

interface LocaleRouteDecisionBase {
  locale: Locale;
}

/** What a served decision tells the edge HTML cache, so it never re-derives the route. */
interface ServedPage {
  /** Path below the locale prefix: decoded, sanitized, and without a trailing slash. */
  pathname: string;
  /** The one URL path this page is served at in this locale. */
  canonical: string;
}

export type LocaleRouteDecision =
  | (LocaleRouteDecisionBase & ServedPage & { type: "next" })
  | (LocaleRouteDecisionBase & ServedPage & { type: "rewrite"; location: string })
  | (LocaleRouteDecisionBase & { type: "redirect"; location: string });

// Open-redirect guard: `decodeURI` leaves an encoded backslash alone, and the WHATWG URL parser
// silently strips TAB/LF/CR, so `new URL("/\t/host", base)` collapses to `//host`. Escape the
// backslash, drop those three characters, and collapse repeated slashes before anything reads it.
function sanitizePathname(pathname: string): string {
  return pathname
    .replaceAll("\\", "%5C")
    .replaceAll(/[\t\n\r]/g, "")
    .replaceAll(/\/+/g, "/");
}

// `trailingSlash` is unset in this repo, so a trailing slash is dropped from any path but the root.
function normalizeTrailingSlash(pathname: string): string {
  return pathname !== "/" && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

// The same comparison Next makes: a rewrite to the URL the request already carries is a no-op, so
// it must be a plain `next()`. Re-encoded through `URL`, because the incoming pathname is encoded
// while the target was built from the decoded one.
function isSameLocation({ pathname, target }: { pathname: string; target: string }): boolean {
  return (
    normalizeTrailingSlash(pathname) ===
    normalizeTrailingSlash(new URL(target, "http://l").pathname)
  );
}

/**
 * Which response `src/proxy.ts` owes this request, or `null` when the pathname cannot be decoded —
 * hand those to Next untouched, which answers 400.
 */
export function decideLocaleRoute(request: LocaleRouteRequest): LocaleRouteDecision | null {
  let decoded: string;

  try {
    // Resolve foreign symbols, e.g. `/es/%C3%B1` → `/es/ñ`.
    decoded = decodeURI(request.pathname);
  } catch {
    return null;
  }

  const pathname = sanitizePathname(decoded);
  const resolved = resolveRequestLocale({
    pathname,
    cookieLocale: request.cookieLocale,
    acceptLanguage: request.acceptLanguage,
  });
  const { locale } = resolved;

  const unprefixed = normalizeTrailingSlash(resolved.pathname);
  // The URL this page is served at, and the one the router answers: the app lives under
  // `app/[locale]/`, so the internal path always carries a prefix even when the visitor's does not.
  const canonical = localizedPathname({ pathname: unprefixed, locale });
  const internal = localizedPathname({ pathname: unprefixed, locale, forcePrefix: true });

  // One spelling per page, one hop to it: `/ES/blog`, `/en/blog`, and a bare path that belongs to
  // another locale all redirect. Both sides are decoded and sanitized, so only the prefix can differ.
  if (normalizeTrailingSlash(pathname) !== canonical) {
    return {
      type: "redirect",
      location: canonical + request.search,
      locale,
    };
  }

  const served = { locale, pathname: unprefixed, canonical };

  if (isSameLocation({ pathname: request.pathname, target: internal })) {
    return { type: "next", ...served };
  }

  return { type: "rewrite", location: internal + request.search, ...served };
}
