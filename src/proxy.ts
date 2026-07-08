import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { I18N_ENABLED } from "@/constants";
import { LOCALES } from "@/i18n/config";
import { routing } from "@/i18n/routing";

const intlMiddleware = createMiddleware(routing);

// With i18n disabled the site is served only at the bare, unprefixed path. Any
// lingering locale-prefixed URL (indexed, bookmarked, or hard-coded) — for both
// the default locale and locales no longer served — is temporarily redirected to
// its unprefixed equivalent so there is a single canonical URL while the flag is
// off. Temporary (307) so the mapping is not cached if i18n is re-enabled.
export default function proxy(request: NextRequest) {
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

// Return the path with a leading locale segment removed, or null when there is
// none. Checks the full LOCALES catalog, not just the enabled set, so paths for
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

// Match everything except the authed app, /api, the extension-less /markdown machine
// endpoint, framework and static files, so new public pages under app/[locale]/ are
// covered automatically; edit only when adding an authed section. Other machine endpoints
// (robots.txt, sitemap.xml, docs/llms.txt) are already excluded by the `.*\\..*` dot rule;
// /markdown/* has no extension so it needs an explicit exclusion or next-intl localizes it.
// Keep one negative-lookahead regex — the `/(group)` matcher form fails in Vinext.
export const config = {
  matcher: ["/((?!api|markdown|dashboard|settings|admin|_next|_vercel|.*\\..*).*)"],
};
