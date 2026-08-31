"use client";

import { FormControl } from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { API_KEY_EXPIRY_DAY_OPTIONS } from "@/constants";

// Sentinel for the "never expires" option: a Select needs a non-empty string value, while the
// schema expects the field to be absent.
const NO_EXPIRY_VALUE = "never";

/**
 * The `expiresInDays` control, shared by every key creation form. Days rather than a date so the
 * client never has to agree with the server about time zones — the same reason the services take
 * days. Labels are props because the settings forms translate them and the admin panel does not.
 */
export function ApiKeyExpirySelect({
  value,
  onChange,
  label,
  neverLabel,
  formatDays,
}: {
  value: number | undefined;
  onChange: (days: number | undefined) => void;
  label: string;
  neverLabel: string;
  formatDays: (days: number) => string;
}) {
  return (
    <Select
      value={value ? String(value) : NO_EXPIRY_VALUE}
      onValueChange={(next) => onChange(next === NO_EXPIRY_VALUE ? undefined : Number(next))}
    >
      <FormControl>
        <SelectTrigger aria-label={label}>
          <SelectValue>
            {(selected: string | null) =>
              selected && selected !== NO_EXPIRY_VALUE
                ? formatDays(Number(selected))
                : neverLabel}
          </SelectValue>
        </SelectTrigger>
      </FormControl>
      <SelectContent>
        <SelectItem value={NO_EXPIRY_VALUE}>{neverLabel}</SelectItem>
        {API_KEY_EXPIRY_DAY_OPTIONS.map((days) => (
          <SelectItem key={days} value={String(days)}>
            {formatDays(days)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
