"use client";

import { useIsClient } from "usehooks-ts";

import type { Locale } from "@/i18n/config";
import { formatDateTime, formatRelativeDateTime } from "@/utils/format-date";

/**
 * The server and the browser read "now" at different times, so a relative time can differ
 * across a minute boundary and break hydration. Render the fixed absolute time until mount.
 */
export function ClientRelativeTime({
  value,
  locale,
}: {
  value: Date | string | number;
  locale: Locale;
}) {
  const isClient = useIsClient();
  const date = new Date(value);

  return (
    <time dateTime={date.toISOString()}>
      {isClient ? formatRelativeDateTime(date, locale) : formatDateTime(date, locale)}
    </time>
  );
}
