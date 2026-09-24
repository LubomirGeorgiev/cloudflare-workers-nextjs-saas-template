import { LOCALE_COOKIE_MAX_AGE, LOCALE_COOKIE_NAME, type Locale } from "./config";

// The one cookie value for "the user chose this locale". Its writers, both in the browser through
// `writeLocaleCookie`, are the switcher (`useChangeLocale`, through `enterLocale`) and the sign-in
// and sign-up hand-off (`useNavigateAfterAuth`), which applies the account's stored preference.
export function buildLocaleCookieValue(locale: Locale): string {
  return `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
}
