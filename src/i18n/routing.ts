import { defineRouting } from "next-intl/routing";

import { I18N_ENABLED } from "@/constants";
import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALE_COOKIE_NAME } from "./config";

export const routing = defineRouting({
  locales: ENABLED_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  // Default locale served at the bare path (/privacy); others prefixed (/es/privacy).
  localePrefix: "as-needed",
  // `/es/*` is translated and indexable, so auto-route `Accept-Language`/cookie
  // visitors onto their preferred locale — Spanish-preference users land on
  // equally good, indexed pages instead of always defaulting to `/en`. With i18n
  // disabled there is only one locale, so there is nothing to negotiate onto.
  localeDetection: I18N_ENABLED,
  localeCookie: {
    name: LOCALE_COOKIE_NAME,
  },
});
