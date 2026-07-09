import { AlertTriangle, Check } from "lucide-react";

import { LocaleFlag } from "@/components/locale-flag";
import { Badge } from "@/components/ui/badge";
import { ENABLED_LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

interface LocaleCoverageBadgesProps {
  translatedLocales: Set<Locale>;
  currentLocale?: string;
  className?: string;
}

export function LocaleCoverageBadges({
  translatedLocales,
  currentLocale,
  className,
}: LocaleCoverageBadgesProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {ENABLED_LOCALES.map((locale) => {
        const isTranslated = translatedLocales.has(locale);
        const isCurrent = locale === currentLocale;

        return (
          <Badge
            key={locale}
            variant={isCurrent ? "default" : "outline"}
            title={`${LOCALE_LABELS[locale]}: ${
              isCurrent ? "current translation" : isTranslated ? "translated" : "missing translation"
            }`}
            className={cn(
              "gap-1 px-1.5 py-0.5 text-xs font-bold uppercase leading-none",
              isCurrent
                ? "border-primary"
                : isTranslated
                ? "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
                : "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300"
            )}
          >
            <LocaleFlag locale={locale} />
            {locale}
            {isCurrent ? <span className="normal-case">current</span> : null}
            {isTranslated ? (
              <Check className="h-3 w-3" />
            ) : (
              <>
                <AlertTriangle className="h-3 w-3" />
                <span className="normal-case">missing</span>
              </>
            )}
          </Badge>
        );
      })}
    </div>
  );
}
