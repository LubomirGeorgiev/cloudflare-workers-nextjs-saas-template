import "server-only";

import { createBase64UrlToken, hashToken } from "@/utils/random-token";

// Invitation tokens are bearer credentials that grant team membership. Generate them from
// the Web Crypto CSPRNG (same source as session tokens in src/utils/auth.ts) rather than a
// non-cryptographic RNG. Only the SHA-256 hash is persisted; the raw token lives only in the
// invitation email link. 32 random bytes ~= 256 bits of entropy.
const INVITATION_TOKEN_BYTES = 32;

export function generateInvitationToken(): string {
  return createBase64UrlToken(INVITATION_TOKEN_BYTES);
}

// Hash the raw token for storage/lookup. Mirrors session-id derivation in src/utils/auth.ts
// so a database read never exposes a usable bearer token.
export async function hashInvitationToken(token: string): Promise<string> {
  return hashToken(token);
}
