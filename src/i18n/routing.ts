import { defineRouting } from "next-intl/routing";

import { I18N_ENABLED } from "@/constants";
import {
  DEFAULT_LOCALE,
  ENABLED_LOCALES,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
} from "./config";

export const routing = defineRouting({
  locales: ENABLED_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  // The default locale uses the bare path; every other locale is prefixed.
  localePrefix: "as-needed",
  // Localized routes are translated and indexable, so route `Accept-Language`/cookie visitors onto their
  // preferred locale instead of always serving the default. With i18n disabled there is only one locale,
  // so there is nothing to negotiate onto.
  localeDetection: I18N_ENABLED,
  // Without `maxAge` next-intl writes a session cookie, while the switcher and the edge HTML cache
  // write `LOCALE_COOKIE_MAX_AGE` — see `buildLocaleCookieValue`. All three must agree.
  localeCookie: {
    name: LOCALE_COOKIE_NAME,
    maxAge: LOCALE_COOKIE_MAX_AGE,
  },
});
