"use client";

import { AlertTriangle, Globe, Loader2, Plus } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { LocaleFlag } from "@/components/locale-flag";
import {
  ENABLED_LOCALES,
  LOCALE_LABELS,
  type Locale,
} from "@/i18n/config";

// Shared editor-header translations panel: shows every enabled locale for the
// item being edited — the current one, links to existing siblings, and
// create-buttons for the missing ones. The entry/tag models differ only in the
// action and sibling shape, both of which the wrapper supplies via props; the
// shell (globe header, coverage badges, AI checkbox, single-locale guard) is
// identical, so it lives here.
export function CmsTranslationSwitcher<
  Sibling extends { locale: Locale; isStale?: boolean }
>({
  currentLocale,
  siblings,
  hrefForSibling,
  onCreate,
  isExecuting,
  aiEnabled,
  onAiEnabledChange,
}: {
  currentLocale: Locale;
  siblings: Sibling[];
  hrefForSibling: (sibling: Sibling) => string;
  onCreate: (targetLocale: Locale) => void;
  isExecuting: boolean;
  aiEnabled: boolean;
  onAiEnabledChange: (enabled: boolean) => void;
}) {
  const siblingByLocale = new Map(siblings.map((sibling) => [sibling.locale, sibling]));

  // Nothing to switch between when the site serves a single locale.
  if (ENABLED_LOCALES.length <= 1) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
      <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <Globe className="h-4 w-4" />
        Translations
      </span>

      {ENABLED_LOCALES.map((locale) => {
        const label = (
          <>
            <LocaleFlag locale={locale} /> {LOCALE_LABELS[locale]}
          </>
        );

        if (locale === currentLocale) {
          return (
            <Badge key={locale} variant="default" className="gap-1">
              {label} · editing
            </Badge>
          );
        }

        const sibling = siblingByLocale.get(locale);
        if (sibling) {
          const isStale = sibling.isStale === true;
          return (
            <a
              key={locale}
              href={hrefForSibling(sibling)}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "gap-1",
                isStale && "border-amber-400 text-amber-700 dark:text-amber-400"
              )}
              title={
                isStale
                  ? `${LOCALE_LABELS[locale]} translation is out of date`
                  : `Edit ${LOCALE_LABELS[locale]} translation`
              }
            >
              {label}
              {isStale && <AlertTriangle className="h-3.5 w-3.5" />}
            </a>
          );
        }

        return (
          <Button
            key={locale}
            variant="outline"
            size="sm"
            className="gap-1 border-amber-300 text-amber-700"
            disabled={isExecuting}
            onClick={() => onCreate(locale)}
            title={`Create ${LOCALE_LABELS[locale]} translation`}
          >
            {isExecuting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {label}
          </Button>
        );
      })}

      <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={aiEnabled}
          onChange={(event) => onAiEnabledChange(event.target.checked)}
          className="h-3.5 w-3.5 accent-primary"
        />
        Auto-translate with AI
      </label>
    </div>
  );
}
