import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { I18N_ENABLED } from "@/constants";
import { LOCALES } from "@/i18n/config";
import { shouldLocalizePathname } from "@/i18n/localized-paths";
import { routing } from "@/i18n/routing";
import { isOgImageRequest } from "@/lib/og/og-paths";

const intlMiddleware = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  if (!shouldLocalizePathname(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  // With i18n disabled, locale-prefixed URLs collapse to one canonical bare path.
  // Use 307 so indexed/bookmarked prefixes keep working without caching a permanent
  // mapping if i18n is re-enabled.
  if (!I18N_ENABLED) {
    const stripped = stripLocalePrefix(request.nextUrl.pathname);
    if (stripped !== null) {
      const url = request.nextUrl.clone();
      url.pathname = stripped;
      return NextResponse.redirect(url, 307);
    }
  }

  const response = intlMiddleware(request);

  // An OG card is a public image whose locale is already in its path, so the locale cookie buys it
  // nothing — and Cloudflare BYPASSes the cache for any response carrying Set-Cookie. Social
  // crawlers never send cookies back, so without this every crawl re-renders (satori + resvg).
  // Safe as a blanket delete only because no other cookie is set on these routes, and because a
  // page URL shaped like a card (`/blog/opengraph-image-launch`) is excluded by the request itself.
  if (isOgImageRequest({ pathname: request.nextUrl.pathname, headers: request.headers })) {
    response.headers.delete("set-cookie");
  }

  return response;
}

// Checks the full LOCALES catalog, not just the enabled set, so paths for
// disabled locales are caught too.
function stripLocalePrefix(pathname: string): string | null {
  for (const locale of LOCALES) {
    if (pathname === `/${locale}`) {
      return "/";
    }
    if (pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(locale.length + 1);
    }
  }
  return null;
}

// Only framework-internal paths are excluded here; which app paths get localized is
// `shouldLocalizePathname`'s call, so that rule stays importable and testable. Use one
// negative-lookahead regex because Vinext fails the `/(group)` matcher form.
export const config = {
  matcher: ["/((?!_next|_vercel).*)"],
};
