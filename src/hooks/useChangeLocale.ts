"use client";

import * as React from "react";
import { useLocale } from "@/i18n/client";

import type { Locale } from "@/i18n/config";
import { enterLocale, persistUserLocale } from "@/i18n/locale-cookie.client";
import { relocalizeHref } from "@/i18n/localize-href";
import { usePathname } from "@/i18n/navigation";

// Persist the preference, then hard-navigate to the current page under the new locale.
// The URL prefix decides the locale, so a plain reload would keep the old one.
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
        // The stored preference only carries the choice to the next device. A failed save must
        // not strand the user on the old locale, and `enterLocale` must wait until it settles.
        await persistUserLocale(locale).catch((error: unknown) => {
          console.error("Failed to persist the locale preference:", error);
        });

        // `usePathname()` drops the query and the hash; a dropped `?redirect=` strands sign-in.
        enterLocale({
          locale,
          href: relocalizeHref({
            href: pathname + window.location.search + window.location.hash,
            locale,
          }),
        });
      });
    },
    [activeLocale, pathname],
  );

  return { changeLocale, isPending };
}
