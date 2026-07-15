"use server";

import { eq } from "drizzle-orm";

import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { getSessionFromCookie } from "@/utils/auth";

import {
  ENABLED_LOCALES,
  type Locale,
} from "./config";

// Logged-in users get the locale saved to the DB so the preference follows them
// across devices. The client owns the non-HttpOnly cookie: mutating it here makes
// Vinext revalidate the old localized route, whose prefetches restore that locale.
export async function setUserLocale(locale: Locale): Promise<void> {
  // Validate against the served set: the UI hides the switcher when i18n is off,
  // but this action is the real trust boundary, so reject any locale that isn't
  // actually served rather than persisting an un-routed preference.
  if (!ENABLED_LOCALES.includes(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }

  const session = await getSessionFromCookie();
  if (session?.user) {
    await getDB()
      .update(userTable)
      .set({ preferredLocale: locale })
      .where(eq(userTable.id, session.user.id));
  }
}
