import "server-only";

import { SITE_URL } from "@/constants";
import type { Locale } from "@/i18n/config";
import { routing } from "@/i18n/routing";

// Deliberately does NOT use `getPathname` from `@/i18n/navigation`: that module is
// built with next-intl's `createNavigation`, which imports `next/navigation` client
// hooks that fail to load outside a Next.js module graph (Workers integration
// tests, queue consumers sending emails). The routing config defines no `pathnames`
// map, so localizing a pathname is purely a locale-prefix decision.
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

function localizedPathname({ pathname, locale }: { pathname: string; locale: Locale }): string {
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

// Concatenates instead of `new URL(path, SITE_URL)` on purpose: when SITE_URL carries its own base path
// (e.g. hosted under a subpath), an absolute pathname passed to `new URL` replaces that base path and
// silently drops it. Joining the strings preserves it; the slash trimming/prefixing just guards against a double or missing separator between the two parts.
export function absoluteLocalizedUrl({ pathname, locale }: { pathname: string; locale: Locale }): string {
  const siteUrl = SITE_URL.endsWith("/") ? SITE_URL.slice(0, -1) : SITE_URL;

  return `${siteUrl}${localizedPathname({ pathname, locale })}`;
}
