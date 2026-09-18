import type { Locale } from "./config";
import { routing } from "./routing";

// Deliberately does NOT use `getPathname` from `./navigation`: that module is built with
// next-intl's `createNavigation`, which imports `next/navigation` client hooks that fail to
// load outside a Next.js module graph (Workers integration tests, queue consumers sending
// emails, unit tests). The routing config defines no `pathnames` map, so localizing a
// pathname is purely a locale-prefix decision.
type LocalePrefixMode = "always" | "as-needed" | "never";

// Widened via a parameter (not a const annotation, which flow-narrowing defeats)
// so the branching stays valid if a downstream template changes the routing mode.
function resolveLocalePrefixMode(
  prefix: LocalePrefixMode | { mode?: LocalePrefixMode } | undefined,
): LocalePrefixMode {
  if (typeof prefix === "object") {
    return prefix.mode ?? "always";
  }
  // "always" is next-intl's default when unset.
  return prefix ?? "always";
}

// The single home for "which URL serves this path in this locale". The edge HTML cache, the
// sitemap, robots.txt, the Markdown routes, and the locale switcher must all agree on it.
export function localizedPathname({ pathname, locale }: { pathname: string; locale: Locale }): string {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const mode = resolveLocalePrefixMode(routing.localePrefix);
  const needsPrefix = mode === "never"
    ? false
    : mode === "as-needed"
      ? locale !== routing.defaultLocale
      : true;

  if (!needsPrefix) {
    return normalized;
  }

  return normalized === "/" ? `/${locale}` : `/${locale}${normalized}`;
}
