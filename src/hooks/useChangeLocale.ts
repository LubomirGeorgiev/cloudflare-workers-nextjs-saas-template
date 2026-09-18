"use client";

import * as React from "react";
import { useLocale } from "next-intl";

import type { Locale } from "@/i18n/config";
import { buildLocaleHref } from "@/i18n/locale-href";
import { usePathname } from "@/i18n/navigation";
import { persistUserLocale } from "@/i18n/locale-cookie.client";

// Persist the preference, then hard-navigate to the current page under the new locale.
// The URL prefix decides the locale, so a plain reload keeps the old one and next-intl
// writes the old locale back into the cookie.
export function useChangeLocale() {
  const activeLocale = useLocale();
  const pathname = usePathname();
  const [isPending, startTransition] = React.useTransition();

  const changeLocale = React.useCallback(
    (locale: Locale) => {
      // Every caller lists the active locale too, so guard here rather than in each menu.
      if (locale === activeLocale) {
        return;
      }

      startTransition(async () => {
        // The URL prefix is what selects the locale; the stored preference only carries the
        // choice to the next device. A failed write must not strand the user on the old one.
        await persistUserLocale(locale).catch((error: unknown) => {
          console.error("Failed to persist the locale preference:", error);
        });

        window.location.href = buildLocaleHref({
          pathname,
          locale,
          search: window.location.search,
          hash: window.location.hash,
        });
      });
    },
    [activeLocale, pathname],
  );

  return { changeLocale, isPending };
}
