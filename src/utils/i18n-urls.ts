import "server-only";

import { SITE_URL } from "@/constants";
import type { Locale } from "@/i18n/config";
import { localizedPathname } from "@/i18n/localized-pathname";

// Concatenates instead of `new URL(path, SITE_URL)` on purpose: when SITE_URL carries its own base path
// (e.g. hosted under a subpath), an absolute pathname passed to `new URL` replaces that base path and
// silently drops it. Joining the strings preserves it; the slash trimming/prefixing just guards against a double or missing separator between the two parts.
export function absoluteLocalizedUrl({ pathname, locale }: { pathname: string; locale: Locale }): string {
  const siteUrl = SITE_URL.endsWith("/") ? SITE_URL.slice(0, -1) : SITE_URL;

  return `${siteUrl}${localizedPathname({ pathname, locale })}`;
}
