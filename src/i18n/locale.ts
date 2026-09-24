import "server-only";

import { cookies, headers } from "next/headers";

import { getBearerPrincipal } from "@/lib/api/principal";
import {
  DEFAULT_LOCALE,
  isEnabledLocale,
  LOCALE_COOKIE_NAME,
  LOCALE_DETECTION,
  LOCALE_HEADER_NAME,
  type Locale,
} from "./config";
import { negotiateAcceptLanguage } from "./resolve-locale";

// The one answer to "what locale is this request": the bearer principal's preference, then the
// locale `src/proxy.ts` forwarded from the URL, then the cookie, the stored preference, and
// Accept-Language. The URL wins so an email sent from `/es/...` matches the page the visitor saw.
export async function getUserLocale(): Promise<Locale> {
  // Same gate as `resolveRequestLocale`: with one served locale every signal resolves to the
  // default, so skip the cookie, session, and header reads.
  if (!LOCALE_DETECTION) {
    return DEFAULT_LOCALE;
  }

  // Bearer requests (API + MCP) are served by plain Worker handlers, outside the App Router
  // request scope where `cookies()`/`headers()` throw. A credential carries no cookie anyway,
  // so the user's stored preference is the only signal there.
  const principal = getBearerPrincipal();
  if (principal) {
    const preferredLocale = principal.user?.preferredLocale;

    return isEnabledLocale(preferredLocale) ? preferredLocale : DEFAULT_LOCALE;
  }

  const headerStore = await headers();
  const forwarded = headerStore.get(LOCALE_HEADER_NAME);
  if (isEnabledLocale(forwarded)) {
    return forwarded;
  }

  // The cookie is the latest choice on this device, so it beats the stored preference.
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  if (isEnabledLocale(fromCookie)) {
    return fromCookie;
  }

  // Never a module-scope import: the Worker entry reaches this file through `@/i18n/server`,
  // and `@/utils/auth` drags the session/D1 layer — the whole Drizzle schema — onto every
  // cold isolate. `getBearerPrincipal` stays static; it is type-only against kv-session.
  const { getCurrentSession } = await import("@/utils/auth");

  const session = await getCurrentSession();
  const preferred = session?.user?.preferredLocale;
  if (isEnabledLocale(preferred)) {
    return preferred;
  }

  return negotiateAcceptLanguage(headerStore.get("accept-language"));
}
