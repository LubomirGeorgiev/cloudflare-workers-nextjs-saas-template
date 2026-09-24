import type { Locale } from "./config";
import { stripLocalePrefix } from "./locale-prefix";
import { localizedPathname } from "./localized-pathname";

interface LocalizeHrefArgs {
  href: string;
  locale: Locale;
}

// The path and the query-plus-hash of a bare in-app href, or `null` for an external,
// protocol-relative, or relative href, which passes through unchanged.
function splitInAppHref(href: string): { pathname: string; suffix: string } | null {
  if (!href.startsWith("/") || href.startsWith("//")) {
    return null;
  }

  const suffixIndex = href.search(/[?#]/);

  return suffixIndex === -1
    ? { pathname: href, suffix: "" }
    : { pathname: href.slice(0, suffixIndex), suffix: href.slice(suffixIndex) };
}

/**
 * The href that serves `href` in `locale`. Only a bare in-app path gets the locale prefix: an
 * external or protocol-relative URL, a relative path, and a path that already carries a locale
 * prefix pass through unchanged. Free of `next/*`, so server, client, and Workers code share it.
 */
export function localizeHref({ href, locale }: LocalizeHrefArgs): string {
  const parts = splitInAppHref(href);

  if (!parts || stripLocalePrefix(parts.pathname) !== null) {
    return href;
  }

  return localizedPathname({ pathname: parts.pathname, locale }) + parts.suffix;
}

/**
 * Like `localizeHref`, but a path that already carries a locale prefix gets `locale`'s prefix
 * instead. The URL prefix decides the page locale, so a kept prefix would show the old locale.
 */
export function relocalizeHref({ href, locale }: LocalizeHrefArgs): string {
  const parts = splitInAppHref(href);

  if (!parts) {
    return href;
  }

  const pathname = stripLocalePrefix(parts.pathname) ?? parts.pathname;

  return localizedPathname({ pathname, locale }) + parts.suffix;
}
