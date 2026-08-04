import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { getUserLocale } from "./locale";
import { loadMessages } from "./load-messages";
import { routing } from "./routing";

// Hybrid config. On locale-prefixed public routes, `requestLocale` is the [locale] URL
// segment and wins. On the cookie-based app/API surface it is undefined, so we fall back
// to getUserLocale() (cookie -> user.preferredLocale -> Accept-Language -> default).
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : await getUserLocale();

  return {
    locale,
    messages: await loadMessages(locale),
  };
});
