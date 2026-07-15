"use client";

import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  type Locale,
} from "./config";
import { setUserLocale } from "./locale-actions";

export async function persistUserLocale(locale: Locale): Promise<void> {
  await setUserLocale(locale);

  // The action POST targets the old URL. Write only after it returns so next-intl
  // cannot synchronize the new cookie back to that URL's locale.
  document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
}
