"use client";

import { format } from "date-fns";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { formatRelativeDateTime } from "@/utils/format-date";

/** Full timestamp shown on hover; date-fns pattern for "Apr 29, 1453 at 1:12:00 PM". */
const ABSOLUTE_DATE_FORMAT = "PPpp";

/**
 * The admin tables' date cell: relative for scanning, absolute on hover for precision.
 * Deliberately on DEFAULT_LOCALE — the admin surface is not localized per viewer.
 */
export function RelativeDateCell({
  value,
  emptyLabel,
}: {
  value: Date | null | undefined;
  /** Rendered instead of a date when there is none, e.g. "Never". */
  emptyLabel?: string;
}) {
  if (!value) {
    return emptyLabel ? <span className="text-muted-foreground">{emptyLabel}</span> : null;
  }

  return (
    <Tooltip>
      <TooltipTrigger>{formatRelativeDateTime(value, DEFAULT_LOCALE)}</TooltipTrigger>
      <TooltipContent>
        <p>{format(new Date(value), ABSOLUTE_DATE_FORMAT)}</p>
      </TooltipContent>
    </Tooltip>
  );
}
