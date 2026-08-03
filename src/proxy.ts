import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { I18N_ENABLED } from "@/constants";
import { LOCALES } from "@/i18n/config";
import { shouldLocalizePathname } from "@/i18n/localized-paths";
import { routing } from "@/i18n/routing";

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

  return intlMiddleware(request);
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
