import "server-only";

import { cookies, headers } from "next/headers";

import { I18N_ENABLED } from "@/constants";
import { getBearerPrincipal } from "@/lib/api/principal";
import { matchAcceptLanguage } from "./accept-language";
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  LOCALE_COOKIE_NAME,
  type Locale,
} from "./config";

// Resolve the active locale for the current request: an explicit cookie wins,
// then the authenticated user's stored preference, then Accept-Language
// negotiation, otherwise fall back to the default.
export async function getUserLocale(): Promise<Locale> {
  // Perf short-circuit: in single-locale mode isSupportedLocale already rejects
  // everything but DEFAULT_LOCALE, so this only skips the cookie/session/header
  // reads — correctness no longer depends on it.
  if (!I18N_ENABLED) {
    return DEFAULT_LOCALE;
  }

  // Bearer requests (API + MCP) are served by plain Worker handlers, outside the App Router
  // request scope where `cookies()`/`headers()` throw. A credential carries no cookie anyway,
  // so the user's stored preference is the only signal there.
  const principal = getBearerPrincipal();
  if (principal) {
    const preferredLocale = principal.user?.preferredLocale;

    return isSupportedLocale(preferredLocale) ? preferredLocale : DEFAULT_LOCALE;
  }

  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  if (isSupportedLocale(fromCookie)) {
    return fromCookie;
  }

  // Never a module-scope import: the Worker entry reaches this file through next-intl's request
  // config, and `@/utils/auth` drags the session/D1 layer — the whole Drizzle schema — onto every
  // cold isolate. `getBearerPrincipal` stays static; it is type-only against kv-session.
  const { getCurrentSession } = await import("@/utils/auth");

  // Authenticated users fall back to their stored preference before header negotiation.
  const session = await getCurrentSession();
  const preferred = session?.user?.preferredLocale;
  if (isSupportedLocale(preferred)) {
    return preferred;
  }

  const headerStore = await headers();
  return matchAcceptLanguage(headerStore.get("accept-language")) ?? DEFAULT_LOCALE;
}
