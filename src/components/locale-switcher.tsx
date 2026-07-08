"use client"

import * as React from "react"
import { Globe, Check } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { usePathname, getPathname } from "@/i18n/navigation"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { ENABLED_LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/config"
import { LocaleFlag } from "@/components/locale-flag"
import { setUserLocale } from "@/i18n/locale-actions"

interface LocaleSwitcherProps {
  className?: string
}

export default function LocaleSwitcher({ className }: LocaleSwitcherProps) {
  const t = useTranslations("Client.LocaleSwitcher")
  const activeLocale = useLocale() as Locale
  const pathname = usePathname()
  const [isPending, startTransition] = React.useTransition()

  const onSelect = (locale: Locale) => {
    if (locale === activeLocale) {
      return
    }

    startTransition(async () => {
      // Persist preference (cookie) so the app surface honors it too.
      await setUserLocale(locale)
      // The NextIntlClientProvider sits in the root layout (above [locale]) and is
      // shared across locales, so a soft navigation won't re-render it — useLocale()
      // and translations stay stale. Hard-navigate so it re-reads the new locale.
      window.location.href = getPathname({ href: pathname, locale })
    })
  }

  // Nothing to switch between when i18n is disabled (single active locale).
  if (ENABLED_LOCALES.length <= 1) {
    return null
  }

  return (
    // Wrap in a single inline-flex element. When the menu opens, Base UI injects
    // focus-guard <span>s as siblings of the trigger; kept inside this wrapper they
    // stay out of the parent's layout. Otherwise, in a `space-x-*` row (the navbar),
    // the trigger stops being the last child and gains a margin, shifting the row.
    <span className="inline-flex">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              className={className}
              disabled={isPending}
            />
          }
        >
          <Globe className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">{t("change")}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {ENABLED_LOCALES.map((locale) => (
            <DropdownMenuItem
              key={locale}
              onClick={() => onSelect(locale)}
              className="justify-between gap-4"
            >
              <span className="flex items-center gap-2">
                <LocaleFlag locale={locale} />
                {LOCALE_LABELS[locale]}
              </span>
              <Check
                className={cn(
                  "h-4 w-4",
                  locale === activeLocale ? "opacity-100" : "opacity-0"
                )}
              />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}
