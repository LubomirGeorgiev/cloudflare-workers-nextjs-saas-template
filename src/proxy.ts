import { NextResponse, type NextRequest } from "next/server";

import { LOCALE_COOKIE_NAME, LOCALE_HEADER_NAME } from "@/i18n/config";
import { shouldLocalizePathname } from "@/i18n/localized-paths";
import { decideLocaleRoute, type LocaleRouteDecision } from "@/i18n/middleware";

// Deliberately no ban check here, and none in `worker-entrypoint.ts` either. Neither layer has a
// database context, and the session cookie is opaque to both, so a check would cost a D1 read on
// every request — including public pages. Bans are enforced where the session and the bearer
// credentials are resolved; see `src/lib/account/ban.ts`.

// Only the locale route lives here: it needs the middleware slot for its rewrite. Everything the
// edge can decide from the URL alone — the disabled-i18n prefix collapse — runs in
// `worker-entrypoint.ts` instead. `decideLocaleRoute` holds the decision; this is the adapter.
export default function proxy(request: NextRequest) {
  if (!shouldLocalizePathname(request.nextUrl.pathname)) {
    return passThrough(request);
  }

  // Only an explicit choice writes the cookie (writers in `src/i18n/locale-cookie.ts`); this only
  // reads it. Vinext would also pin a middleware response that carries `Set-Cookie` to `no-store`.
  const decision = decideLocaleRoute({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    cookieLocale: request.cookies.get(LOCALE_COOKIE_NAME)?.value ?? null,
    acceptLanguage: request.headers.get("accept-language"),
  });

  // An undecodable pathname: Next answers it with a 400.
  if (!decision) {
    return passThrough(request);
  }

  return buildResponse({ decision, request });
}

// `getLocale()` trusts the forwarded locale header, so a client must not be able to send its own.
function passThrough(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete(LOCALE_HEADER_NAME);

  return NextResponse.next({ request: { headers } });
}

function buildResponse({
  decision,
  request,
}: {
  decision: LocaleRouteDecision;
  request: NextRequest;
}): NextResponse {
  if (decision.type === "redirect") {
    return NextResponse.redirect(new URL(decision.location, request.url));
  }

  // `getLocale()` in `@/i18n/server` reads the resolved locale from here, so a render never has to
  // negotiate again.
  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER_NAME, decision.locale);

  if (decision.type === "rewrite") {
    return NextResponse.rewrite(new URL(decision.location, request.url), { request: { headers } });
  }

  return NextResponse.next({ request: { headers } });
}

// Only framework-internal paths are excluded here; which app paths get localized is
// `shouldLocalizePathname`'s call, so that rule stays importable and testable. Use one
// negative-lookahead regex because Vinext fails the `/(group)` matcher form.
export const config = {
  matcher: ["/((?!_next|_vercel).*)"],
};
