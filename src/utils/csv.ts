/**
 * Leading characters a spreadsheet reads as the start of a formula, not as text. Any value that
 * reaches a CSV may be customer input, so `=1+1` must not become a live cell in a staff export.
 */
const CSV_FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

type CsvValue = string | number | null | undefined;

/**
 * RFC 4180 quoting, after an apostrophe neutralizes any formula prefix: a value with a comma or a
 * quote must not split or break the row, and no cell may run when the sheet opens it.
 */
export function toCsvField(value: CsvValue): string {
  const text = value === null || value === undefined ? "" : String(value);
  const inert = CSV_FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix)) ? `'${text}` : text;

  return `"${inert.replaceAll('"', '""')}"`;
}

/**
 * Builds the whole document so no caller re-derives the header join or the row separator. The
 * header goes through the same escape as the body, because a future caller may derive it from data.
 */
export function toCsv({ header, rows }: { header: string[]; rows: CsvValue[][] }): string {
  const lines = [header, ...rows].map((row) => row.map(toCsvField).join(","));

  return lines.join("\n");
}
