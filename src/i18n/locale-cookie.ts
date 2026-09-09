import { LOCALE_COOKIE_MAX_AGE, LOCALE_COOKIE_NAME, type Locale } from "./config";

// The one `Set-Cookie` value for the locale preference. The switcher writes it in the browser and
// the edge HTML cache writes it on a hit, where `src/proxy.ts` never runs — one string, so the two
// cannot drift apart. The proxy's own write is `routing.localeCookie`; keep its attributes equal.
export function buildLocaleCookieValue(locale: Locale): string {
  return `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
}
