import "server-only";

import { and, eq, inArray, or } from "drizzle-orm";

import { getDB } from "@/db";
import { bannedEmailTable } from "@/db/schema";
import { ActionError, type ActionErrorMessageKey } from "@/lib/action-error";
import { BLOCKED_EMAIL_KINDS, buildEmailMatchCandidates } from "@/utils/email-pattern";

// The one read every account-creation path makes. The blocklist governs account CREATION; an
// account that already exists is stopped by a ban instead (`src/lib/account/ban.ts`). Keep the
// two apart: adding a pattern must never revoke access, and banning must never block a domain.
//
// There is deliberately no KV cache. Sign-up already carries RATE_LIMITS.SIGN_UP, so the query
// volume is trivial, and a cache would need invalidating on every blocklist write.

const DEFAULT_BLOCKED_MESSAGE_KEY: ActionErrorMessageKey =
  "Client.Auth.SignUp.errorEmailNotAllowed";

/**
 * One indexed query per address. Every branch is an equality lookup against
 * `banned_email_kind_value_unique`; the wildcard never becomes a table scan or a `LIKE` search.
 */
export async function isEmailBlocked(email: string): Promise<boolean> {
  const candidates = buildEmailMatchCandidates(email);

  // Not an address at all. The caller's own email validation refuses it; this guard has no
  // opinion, and returning "blocked" here would refuse a malformed input for the wrong reason.
  if (!candidates) {
    return false;
  }

  const match = await getDB()
    .select({ id: bannedEmailTable.id })
    .from(bannedEmailTable)
    .where(or(
      and(
        eq(bannedEmailTable.kind, BLOCKED_EMAIL_KINDS.EMAIL),
        eq(bannedEmailTable.value, candidates.address),
      ),
      and(
        eq(bannedEmailTable.kind, BLOCKED_EMAIL_KINDS.DOMAIN),
        eq(bannedEmailTable.value, candidates.domain),
      ),
      and(
        eq(bannedEmailTable.kind, BLOCKED_EMAIL_KINDS.DOMAIN_SUFFIX),
        inArray(bannedEmailTable.value, candidates.domainSuffixes),
      ),
    ))
    .limit(1);

  return match.length > 0;
}

/**
 * The refusal copy is neutral on purpose: it never says "blocked" and never names the pattern
 * that matched, so a registrant cannot map out the blocklist one address at a time.
 */
export async function assertEmailNotBlocked({
  email,
  messageKey = DEFAULT_BLOCKED_MESSAGE_KEY,
}: {
  email: string;
  /** Override only where the surface differs, e.g. accepting a team invitation. */
  messageKey?: ActionErrorMessageKey;
}): Promise<void> {
  if (await isEmailBlocked(email)) {
    throw new ActionError("FORBIDDEN", { key: messageKey });
  }
}
