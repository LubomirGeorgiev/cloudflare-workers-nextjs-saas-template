// The liveness rule is written twice: once as drizzle SQL, once as the raw string the capacity
// guard needs inside its INSERT. Nothing else notices when only one of them changes.

import { SQLiteDialect } from "drizzle-orm/sqlite-core";
import { expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { LIVE_API_KEY_SQL, isDeadApiKey, isLiveApiKey } = await import("@/lib/api-keys/liveness");

const dialect = new SQLiteDialect();
const NOW = new Date("2026-01-01T00:00:00.000Z");

/** The table qualifier and the letter case are drizzle's; the rule is what has to match. */
function render(fragment: Parameters<typeof dialect.sqlToQuery>[0]): string {
  return normalize(dialect.sqlToQuery(fragment).sql.replaceAll(`"api_key".`, ""));
}

function normalize(statement: string): string {
  return statement.toLowerCase().replace(/\s+/g, " ").trim();
}

test("the capacity guard's raw predicate is the same rule as isLiveApiKey", () => {
  expect(render(isLiveApiKey({ now: NOW }))).toBe(normalize(LIVE_API_KEY_SQL));
});

test("isDeadApiKey is the negation of isLiveApiKey, never a second spelling of it", () => {
  expect(render(isDeadApiKey({ now: NOW }))).toBe(`not (${render(isLiveApiKey({ now: NOW }))})`);
});
