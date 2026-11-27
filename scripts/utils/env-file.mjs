import { readFileSync, writeFileSync } from "node:fs";

// Upsert `KEY=value` entries into a .env file: replace an existing key's line in place
// (matching optional leading `export ` and surrounding whitespace), append only the ones
// that aren't already present. Never duplicates keys on re-run.
export function upsertEnvVars(filePath, entries) {
  let content = "";
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    // No .env yet — start from empty and create it.
  }

  const lines = content.length ? content.split("\n") : [];
  const updated = [];
  const appended = [];

  for (const [key, value] of entries) {
    const matcher = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
    const index = lines.findIndex((line) => matcher.test(line));

    if (index !== -1) {
      lines[index] = `${key}=${value}`;
      updated.push(key);
    } else {
      appended.push([key, value]);
    }
  }

  if (appended.length) {
    // Separate appended vars from prior content with a blank line if needed.
    if (lines.length && lines[lines.length - 1].trim() !== "") {
      lines.push("");
    }
    for (const [key, value] of appended) {
      lines.push(`${key}=${value}`);
    }
  }

  writeFileSync(filePath, lines.join("\n"));

  return { updated, appended: appended.map(([key]) => key) };
}
