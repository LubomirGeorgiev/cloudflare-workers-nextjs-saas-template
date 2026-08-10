"use client";

import { Check, Globe } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ENABLED_LOCALES, LOCALE_LABELS } from "@/i18n/config";
import { LocaleFlag } from "@/components/locale-flag";
import { useChangeLocale } from "@/hooks/useChangeLocale";

export function LanguageForm() {
  const t = useTranslations("Client.Settings.Language");
  const activeLocale = useLocale();
  const { changeLocale, isPending } = useChangeLocale();

  // Nothing to switch between when i18n is disabled (single active locale).
  if (ENABLED_LOCALES.length <= 1) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("cardTitle")}</CardTitle>
        <CardDescription>{t("cardDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                disabled={isPending}
                className="w-full justify-between sm:w-64"
              />
            }
          >
            <span className="flex items-center gap-2">
              <LocaleFlag locale={activeLocale} />
              {LOCALE_LABELS[activeLocale]}
            </span>
            <Globe className="h-4 w-4 opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[var(--anchor-width)]">
            {ENABLED_LOCALES.map((locale) => (
              <DropdownMenuItem
                key={locale}
                onClick={() => changeLocale(locale)}
                className="cursor-pointer justify-between gap-4"
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
      </CardContent>
    </Card>
  );
}
