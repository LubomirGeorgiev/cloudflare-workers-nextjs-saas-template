// Timestamps cross the API boundary as ISO 8601 strings. The service layer hands back a mix of
// `Date` (D1 columns) and unix-ms numbers (KV session snapshots), so both are accepted here.
type TimestampInput = Date | number | string | null | undefined;

export function toIsoString(value: Date | number | string): string {
  return new Date(value).toISOString();
}

export function toNullableIsoString(value: TimestampInput): string | null {
  return value === null || value === undefined ? null : toIsoString(value);
}
