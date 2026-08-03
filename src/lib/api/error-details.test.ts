import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { MAX_API_KEYS_PER_TEAM, MAX_API_KEYS_PER_USER } from "@/constants";
import type { ActionErrorMessageKey } from "@/lib/action-error";
import {
  PROBLEM_DETAIL_BY_MESSAGE_KEY,
  resolveKeyedProblemDetail,
} from "@/lib/api/error-details";

// Every keyed refusal these modules can throw is reachable over REST and MCP, where an unlisted
// key collapses to the per-status sentence — the one thing the repo rule forbids for an actionable
// refusal. Scanning the source keeps the audit honest as new throws are added.
const AUDITED_MODULES = ["api-keys/api-keys.ts", "../utils/team-auth.ts"];

// Matches the `{ key: "Client.…" }` form of `new ActionError(code, message)`; the plain-string form
// is already prose and needs no row.
const KEYED_MESSAGE_PATTERN = /\bkey:\s*"([^"]+)"/g;

const LIB_DIR = fileURLToPath(new URL("..", import.meta.url));

function keyedMessagesThrownIn(relativePath: string): ActionErrorMessageKey[] {
  const source = readFileSync(path.join(LIB_DIR, relativePath), "utf8");

  return Array.from(source.matchAll(KEYED_MESSAGE_PATTERN)).map(
    ([, key]) => key as ActionErrorMessageKey,
  );
}

describe("keyed refusals reachable from the API", () => {
  test.each(AUDITED_MODULES)("every key thrown in %s has a problem-detail row", (module) => {
    const keys = keyedMessagesThrownIn(module);

    expect(keys.length).toBeGreaterThan(0);

    const missing = keys.filter((key) => PROBLEM_DETAIL_BY_MESSAGE_KEY[key] === undefined);

    expect(missing).toEqual([]);
  });

  test("no row resolves to an empty or catalog-key detail", () => {
    for (const key of Object.keys(PROBLEM_DETAIL_BY_MESSAGE_KEY) as ActionErrorMessageKey[]) {
      const detail = resolveKeyedProblemDetail({
        messageKey: key,
        messageParams: { max: 1, seats: 1, teamId: "team_1" },
      });

      expect(detail).toBeTruthy();
      expect(detail).not.toMatch(/^(Client|Validation|Emails|Blog)\./);
    }
  });

  // The cap and the way out are the whole point of the row: an agent at the limit must not be told
  // only that its request failed a precondition.
  test.each([
    ["Client.Settings.ApiKeys.errorUserLimitReached", MAX_API_KEYS_PER_USER],
    ["Client.Settings.ApiKeys.errorTeamLimitReached", MAX_API_KEYS_PER_TEAM],
  ] as const)("%s names its limit", (key, max) => {
    const detail = resolveKeyedProblemDetail({ messageKey: key, messageParams: { max } });

    expect(detail).toContain(String(max));
    expect(detail).toMatch(/revoke/i);
  });
});
