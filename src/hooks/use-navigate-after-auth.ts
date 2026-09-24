"use client";

import { useLocale } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import { enterLocale, writeLocaleCookie } from "@/i18n/locale-cookie.client";
import { useRouter } from "@/i18n/navigation";
import { resolvePostAuthTarget } from "@/i18n/post-auth-target";

interface NavigateAfterAuthArgs {
  redirectPath?: string;
  /** The stored preference the sign-in action returned; `null` or absent changes nothing. */
  preferredLocale?: Locale | null;
}

// Every auth success raises a toast and then leaves the page. A `window.location` assignment would
// load a new document, tear down the root layout, and destroy the toast before the user reads it —
// so the hand-off has to be a soft navigation, and `refresh()` is what picks up the new session.
export function useNavigateAfterAuth(): (args?: NavigateAfterAuthArgs) => void {
  const router = useRouter();
  const activeLocale = useLocale();

  return ({ redirectPath, preferredLocale } = {}) => {
    const { href, switchToLocale, cookieLocale } = resolvePostAuthTarget({
      redirectPath,
      activeLocale,
      preferredLocale,
    });

    // A new locale needs a new document; the toast was in the old language anyway, so losing it
    // costs nothing. The auth action already returned, so the cookie write is safe here.
    if (switchToLocale) {
      enterLocale({ locale: switchToLocale, href });
      return;
    }

    if (cookieLocale) {
      writeLocaleCookie(cookieLocale);
    }

    router.refresh();
    router.push(href);
  };
}
