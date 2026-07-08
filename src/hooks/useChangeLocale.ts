"use client";

import * as React from "react";

import { setUserLocale } from "@/i18n/locale-actions";
import type { Locale } from "@/i18n/config";

// Switch the UI locale from an authed (non-locale-prefixed) page. Persists the
// cookie/preference, then hard-reloads so the shared root NextIntlClientProvider
// re-reads the locale — a soft navigation wouldn't re-render it.
export function useChangeLocale() {
  const [isPending, startTransition] = React.useTransition();

  const changeLocale = React.useCallback((locale: Locale) => {
    startTransition(async () => {
      await setUserLocale(locale);
      window.location.reload();
    });
  }, []);

  return { changeLocale, isPending };
}
