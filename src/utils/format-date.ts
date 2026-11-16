import { formatDistanceToNow } from "date-fns";
import { enUS, es } from "date-fns/locale";

import { DEFAULT_TIME_ZONE, type Locale } from "@/i18n/config";

const DATE_FNS_LOCALES = {
  en: enUS,
  es,
} as const satisfies Record<Locale, typeof enUS>;

// `locale` is required (no default) so TypeScript surfaces every call site
// that would otherwise silently format in the default locale. English-only
// surfaces (admin/CMS) pass DEFAULT_LOCALE explicitly.
export function formatDate(date: string | Date, locale: Locale): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: DEFAULT_TIME_ZONE,
  }).format(dateObj);
}

export function formatDateTime(date: string | Date | number, locale: Locale): string {
  return new Date(date).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DEFAULT_TIME_ZONE,
  });
}

// The long form that a legal notice states: a full month name, the time, and the time zone name.
// Components, not `dateStyle`: Intl refuses `timeZoneName` next to a date or time style.
export function formatLongDateTime({ date, locale }: { date: string | Date; locale: Locale }): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: DEFAULT_TIME_ZONE,
  }).format(new Date(date));
}

export function formatRelativeDateTime(date: string | Date | number, locale: Locale): string {
  return formatDistanceToNow(new Date(date), {
    addSuffix: true,
    locale: DATE_FNS_LOCALES[locale],
  });
}
