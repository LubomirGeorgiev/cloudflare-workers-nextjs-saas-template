"use client";

import type { Locale } from "./config";
import { buildLocaleCookieValue } from "./locale-cookie";
import { setUserLocaleAction } from "./locale-actions";

interface EnterLocaleArgs {
  locale: Locale;
  /** The page to open, already under `locale`'s URL prefix. */
  href: string;
}

/** Record the user's locale choice on this device. */
export function writeLocaleCookie(locale: Locale): void {
  document.cookie = buildLocaleCookieValue(locale);
}

/**
 * Record `locale` on this device, then load `href` as a new document. The URL prefix decides the
 * page locale, so a soft navigation would keep the old one. Call it only after any action that
 * targets the old URL settles, so the request that revalidates that URL cannot carry the cookie.
 */
export function enterLocale({ locale, href }: EnterLocaleArgs): void {
  writeLocaleCookie(locale);
  window.location.assign(href);
}

/** Save `locale` as the account's preference. Throws when the server refuses or fails the save. */
export async function persistUserLocale(locale: Locale): Promise<void> {
  const result = await setUserLocaleAction({ locale });

  // A refused write (rate limit, bad input) leaves the stored preference as it was.
  if (result?.serverError) {
    throw new Error(result.serverError.message);
  }

  // Only a confirmed save counts: a `validationErrors` or empty result also leaves it unsaved.
  if (!result?.data?.success) {
    throw new Error("The locale preference was not saved.");
  }
}
