import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { shouldLocalizePathname } from "@/i18n/localized-paths";
import { routing } from "@/i18n/routing";

const intlMiddleware = createMiddleware(routing);

// Deliberately no ban check here, and none in `worker-entrypoint.ts` either. Neither layer has a
// database context, and the session cookie is opaque to both, so a check would cost a D1 read on
// every request — including public pages. Bans are enforced where the session and the bearer
// credentials are resolved; see `src/lib/account/ban.ts`.

// Only next-intl lives here: it needs the middleware slot for its rewrite. Everything the edge can
// decide from the URL alone — the disabled-i18n prefix collapse and the OpenGraph cookie strip —
// runs in `worker-entrypoint.ts` instead.
export default function proxy(request: NextRequest) {
  if (!shouldLocalizePathname(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  return intlMiddleware(request);
}

// Only framework-internal paths are excluded here; which app paths get localized is
// `shouldLocalizePathname`'s call, so that rule stays importable and testable. Use one
// negative-lookahead regex because Vinext fails the `/(group)` matcher form.
export const config = {
  matcher: ["/((?!_next|_vercel).*)"],
};
