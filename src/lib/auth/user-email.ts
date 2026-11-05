import "server-only";

import type { sql } from "drizzle-orm";

import type { userTable } from "@/db/schema";
import { normalizeEmail } from "@/lib/validation";

/**
 * The one way to find a user row by email. Legacy rows can hold mixed case, and the unique index
 * is case-sensitive, so the match compares `lower(email)` with the canonical input.
 */
export function userByEmailWhere(email: string) {
  const canonicalEmail = normalizeEmail(email);

  return {
    RAW: (table: typeof userTable, operators: { sql: typeof sql }) =>
      operators.sql`lower(${table.email}) = ${canonicalEmail}`,
  };
}
