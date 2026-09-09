import "server-only";

import { gt, isNull, not, sql, type SQL } from "drizzle-orm";

import { apiKeyTable } from "@/db/schema";

/**
 * `table` defaults to the real one for a plain `db.select()`. The relational query builder aliases
 * the root table, so a `where: { RAW: ... }` there must pass the instance its callback hands over.
 */
interface ApiKeyLivenessParams {
  now: Date;
  table?: typeof apiKeyTable;
}

/**
 * The same rule as `isLiveApiKey`, spelled in raw SQL for the capacity guard inside the INSERT.
 * `liveness.test.ts` renders the two and fails when they drift apart.
 */
export const LIVE_API_KEY_SQL =
  `(("revokedAt" IS NULL) AND (("expiresAt" IS NULL) OR "expiresAt" > ?))`;

/**
 * The one rule for "a key its holder can still use": not revoked, and not past its own expiry.
 *
 * Every listing, count, and capacity check answers to it, so a fork that changes what "live" means
 * changes it here and nowhere else. Pass the same `now` to both halves of one decision.
 */
export function isLiveApiKey({ now, table = apiKeyTable }: ApiKeyLivenessParams): SQL {
  return sql`(${isNull(table.revokedAt)} and (${isNull(table.expiresAt)} or ${gt(table.expiresAt, now)}))`;
}

/**
 * The exact complement of `isLiveApiKey`, which is what the retention sweep deletes.
 *
 * Exact matters: a row that was neither live nor dead would be invisible on every surface and
 * collected by nothing, so it would sit in D1 forever. Negated rather than restated, so it cannot
 * drift. A key expiring at exactly `now` is already refused by `isLiveApiKey`, so it is dead here.
 */
export function isDeadApiKey(params: ApiKeyLivenessParams): SQL {
  return not(isLiveApiKey(params));
}
