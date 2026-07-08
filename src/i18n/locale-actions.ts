"use server";

import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { getSessionFromCookie } from "@/utils/auth";

import {
  ENABLED_LOCALES,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  type Locale,
} from "./config";

// Persist the user's chosen locale in a cookie (read back by the request config).
// Logged-in users also get it saved to the DB so the preference follows them
// across devices/sessions, not just this browser.
export async function setUserLocale(locale: Locale): Promise<void> {
  // Validate against the served set: the UI hides the switcher when i18n is off,
  // but this action is the real trust boundary, so reject any locale that isn't
  // actually served rather than persisting an un-routed preference.
  if (!ENABLED_LOCALES.includes(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE_NAME, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: false,
  });

  const session = await getSessionFromCookie();
  if (session?.user) {
    await getDB()
      .update(userTable)
      .set({ preferredLocale: locale })
      .where(eq(userTable.id, session.user.id));
  }
}
