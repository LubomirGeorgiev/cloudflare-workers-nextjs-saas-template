import "server-only";

import {
  consumeHashedRecord,
  type HashedRecordPayload,
  putHashedRecord,
} from "@/utils/kv-record";

export const WEBAUTHN_CHALLENGE_TTL_SECONDS = 10 * 60;
const WEBAUTHN_CHALLENGE_PREFIX = "webauthn-challenge:";

export const WEBAUTHN_CHALLENGE_PURPOSE = {
  AUTHENTICATION: "authentication",
  REGISTRATION: "registration",
  SIGN_UP: "sign-up",
} as const;

type WebAuthnChallengePurpose =
  typeof WEBAUTHN_CHALLENGE_PURPOSE[keyof typeof WEBAUTHN_CHALLENGE_PURPOSE];

interface WebAuthnChallengePayload extends HashedRecordPayload {
  purpose: WebAuthnChallengePurpose;
  userId?: string;
}

interface StoreWebAuthnChallengeParams {
  challenge: string;
  purpose: WebAuthnChallengePurpose;
  userId?: string;
}

interface ConsumeWebAuthnChallengeParams {
  challenge: string;
  purpose: WebAuthnChallengePurpose;
}

// Purpose is bound into both the storage key and the payload (defense in depth):
// a challenge issued for one flow cannot be replayed against another.
function challengeKeyFor(purpose: WebAuthnChallengePurpose) {
  return (hash: string) => `${WEBAUTHN_CHALLENGE_PREFIX}${purpose}:${hash}`;
}

export async function storeWebAuthnChallenge({
  challenge,
  purpose,
  userId,
}: StoreWebAuthnChallengeParams): Promise<void> {
  const payload: Omit<WebAuthnChallengePayload, "expiresAt"> = {
    purpose,
    ...(userId ? { userId } : {}),
  };

  await putHashedRecord<WebAuthnChallengePayload>({
    secret: challenge,
    deriveKey: challengeKeyFor(purpose),
    payload,
    expirationTtlSeconds: WEBAUTHN_CHALLENGE_TTL_SECONDS,
  });
}

export async function consumeWebAuthnChallenge({
  challenge,
  purpose,
}: ConsumeWebAuthnChallengeParams): Promise<WebAuthnChallengePayload | null> {
  const result = await consumeHashedRecord<WebAuthnChallengePayload>({
    secret: challenge,
    deriveKey: challengeKeyFor(purpose),
    validate: (payload) => payload.purpose === purpose,
  });

  return result.status === "valid" ? result.payload : null;
}
