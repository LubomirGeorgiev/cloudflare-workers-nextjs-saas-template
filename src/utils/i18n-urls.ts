import "server-only";

import { SITE_URL } from "@/constants";
import type { Locale } from "@/i18n/config";
import { localizedPathname } from "@/i18n/localized-pathname";

// Concatenates instead of `new URL(path, SITE_URL)` on purpose: when SITE_URL carries its own base path
// (e.g. hosted under a subpath), an absolute pathname passed to `new URL` replaces that base path and
// silently drops it. Joining the strings preserves it; the slash trimming/prefixing just guards against a double or missing separator between the two parts.
// `baseUrl` replaces SITE_URL when a caller must stay on the request host (see request-site-url.ts).
export function absoluteLocalizedUrl({
  pathname,
  locale,
  baseUrl = SITE_URL,
}: {
  pathname: string;
  locale: Locale;
  baseUrl?: string;
}): string {
  const siteUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

  return `${siteUrl}${localizedPathname({ pathname, locale })}`;
}
