import "server-only";

import { eq, sql } from "drizzle-orm";

import { getDB } from "@/db";
import { bannedEmailTable, userTable } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import type { CreateBlockedEmailSchema } from "@/schemas/admin-blocked-emails.schema";
import {
  BLOCKED_EMAIL_KINDS,
  parseEmailPattern,
  type BlockedEmailKind,
  type ParsedEmailPattern,
} from "@/utils/email-pattern";

// Shared blocklist administration, the counterpart of `./users.ts`: the admin panel actions and
// the internal REST/MCP surface run one code path.
//
// Deliberately *not* self-authenticating, for the same reason `listAdminUsers` is not: the panel
// authorizes with a cookie session (`requireAdmin`) and the internal API with a bearer credential
// (`assertAdminPrincipal`). Never mount one of these on a route without a guard ahead of it.

export interface AdminBlockedEmail {
  id: string;
  kind: BlockedEmailKind;
  value: string;
  pattern: string;
  reason: string | null;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface AdminBlockedEmailPage {
  entries: AdminBlockedEmail[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const BLOCKED_EMAIL_COLUMNS = {
  id: true,
  kind: true,
  value: true,
  pattern: true,
  reason: true,
  createdByUserId: true,
  createdAt: true,
} as const;

/** The same projection as columns above, in the shape `.returning()` takes. */
const BLOCKED_EMAIL_RETURNING = {
  id: bannedEmailTable.id,
  kind: bannedEmailTable.kind,
  value: bannedEmailTable.value,
  pattern: bannedEmailTable.pattern,
  reason: bannedEmailTable.reason,
  createdByUserId: bannedEmailTable.createdByUserId,
  createdAt: bannedEmailTable.createdAt,
};

export async function listBlockedEmails({
  page,
  pageSize,
}: {
  page: number;
  pageSize: number;
}): Promise<AdminBlockedEmailPage> {
  const db = getDB();

  const [[{ count }], entries] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(bannedEmailTable),
    db.query.bannedEmailTable.findMany({
      columns: BLOCKED_EMAIL_COLUMNS,
      orderBy: { createdAt: "desc" },
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
  ]);

  return {
    entries,
    totalCount: count,
    page,
    pageSize,
    totalPages: Math.ceil(count / pageSize),
  };
}

// Parsed here rather than trusted from the caller: the internal API and the panel share this
// service, and the stored `value` is what the matcher compares against.
function requireParsedPattern(pattern: string): ParsedEmailPattern {
  const parsed = parseEmailPattern(pattern);

  if (!parsed) {
    throw new ActionError(
      "INPUT_PARSE_ERROR",
      "Not a blocklist pattern: expected an address, `*@example.com`, or `*@*.example.com`.",
    );
  }

  return parsed;
}

export async function createBlockedEmail({
  pattern,
  reason,
  createdByUserId,
}: CreateBlockedEmailSchema & { createdByUserId: string | null }): Promise<AdminBlockedEmail> {
  const parsed = requireParsedPattern(pattern);
  const db = getDB();

  // `banned_email_kind_value_unique` makes the same rule typed twice a conflict, not a duplicate
  // row. Read first so the common case returns the specific refusal rather than a raw D1 error;
  // the index is still what actually enforces it against a concurrent insert.
  const existing = await db.query.bannedEmailTable.findFirst({
    where: { kind: parsed.kind, value: parsed.value },
    columns: BLOCKED_EMAIL_COLUMNS,
  });

  if (existing) {
    throw new ActionError("CONFLICT", `This pattern is already blocked: ${existing.pattern}`);
  }

  const [created] = await db
    .insert(bannedEmailTable)
    .values({
      kind: parsed.kind,
      value: parsed.value,
      pattern: parsed.pattern,
      reason: reason ?? null,
      createdByUserId,
    })
    .returning(BLOCKED_EMAIL_RETURNING);

  if (!created) {
    throw new ActionError("INTERNAL_SERVER_ERROR", "The blocklist entry could not be created.");
  }

  return created;
}

export async function deleteBlockedEmail({ id }: { id: string }): Promise<{ success: true }> {
  const deleted = await getDB()
    .delete(bannedEmailTable)
    .where(eq(bannedEmailTable.id, id))
    .returning({ id: bannedEmailTable.id });

  if (deleted.length === 0) {
    throw new ActionError("NOT_FOUND", "No blocklist entry exists with that id.");
  }

  return { success: true };
}

// Legacy rows may hold mixed-case addresses (sign-up historically persisted the raw input), so
// every comparison lowercases the column, exactly as the password sign-in lookup does.
function matchingUsersCondition(parsed: ParsedEmailPattern) {
  const email = sql`lower(${userTable.email})`;

  if (parsed.kind === BLOCKED_EMAIL_KINDS.EMAIL) {
    return sql`${email} = ${parsed.value}`;
  }

  // Domain labels are `[a-z0-9-]` and `.`, so a parsed value can carry no `%` or `_`: these
  // patterns are literal despite being `LIKE`.
  const atDomain = `%@${parsed.value}`;

  if (parsed.kind === BLOCKED_EMAIL_KINDS.DOMAIN) {
    return sql`${email} LIKE ${atDomain}`;
  }

  return sql`(${email} LIKE ${atDomain} OR ${email} LIKE ${`%@%.${parsed.value}`})`;
}

/**
 * How many existing accounts a pattern would have matched. The add dialog shows it, and that is
 * all it does: adding an entry never bans anybody (15.11). Staff ban the matches one at a time.
 */
export async function countUsersMatchingPattern({ pattern }: { pattern: string }): Promise<number> {
  const parsed = requireParsedPattern(pattern);

  const [row] = await getDB()
    .select({ count: sql<number>`count(*)` })
    .from(userTable)
    .where(matchingUsersCondition(parsed));

  return row?.count ?? 0;
}
