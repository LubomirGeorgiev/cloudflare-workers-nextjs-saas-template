"use client";

import type { Locale } from "./config";
import { buildLocaleCookieValue } from "./locale-cookie";
import { setUserLocale } from "./locale-actions";

export async function persistUserLocale(locale: Locale): Promise<void> {
  await setUserLocale(locale);

  // The action POST targets the old URL. Write only after it returns so next-intl
  // cannot synchronize the new cookie back to that URL's locale.
  document.cookie = buildLocaleCookieValue(locale);
}
