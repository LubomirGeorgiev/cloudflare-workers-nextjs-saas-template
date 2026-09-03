import { ActionError } from "@/lib/action-error";

// The one ban test every enforcement point uses. `user.bannedAt` is the authoritative fact and
// every KV snapshot mirrors it, so the same predicate reads a D1 row, a session snapshot, and a
// bearer snapshot without any of them needing to agree on a date type first.

/**
 * KV round-trips JSON, so a mirrored `bannedAt` arrives as a string rather than a `Date`. The
 * test is presence, never a comparison, so both shapes read the same and neither can fail open.
 */
interface BannableUser {
  bannedAt: Date | string | number | null | undefined;
}

export function isBanned(user: BannableUser): boolean {
  return Boolean(user.bannedAt);
}

/**
 * Refuse a banned account with its own message, never "invalid credentials": somebody whose
 * account was suspended has to know to contact support rather than keep trying passwords.
 *
 * Call this AFTER the credential verifies. Checking first would turn every sign-in form into an
 * oracle for which addresses are banned.
 */
export function assertNotBanned(user: BannableUser): void {
  if (isBanned(user)) {
    throw new ActionError("FORBIDDEN", { key: "Client.Auth.SignIn.errorAccountSuspended" });
  }
}
