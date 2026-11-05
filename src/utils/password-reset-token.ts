import "server-only";

import { PASSWORD_RESET_TOKEN_EXPIRATION_SECONDS } from "@/constants";
import { APP_KV_PREFIXES } from "@/constants/kv-prefixes";
import { ActionError } from "@/lib/action-error";
import { getResetTokenKey } from "@/utils/auth-utils";
import { isCurrentGeneration } from "@/utils/kv-principal-cache";
import { getAuthKV } from "@/utils/kv-record";
import {
  createExpiringToken,
  type ExpiringTokenPayload,
  getValidExpiringToken,
  readExpiringToken,
} from "@/utils/kv-token";
import { createRandomId } from "@/utils/random-token";

// The stamp must outlive every link issued before it, so a read that finds no stamp can accept
// its link. That is the link lifetime plus the ~60 s that KV needs to reach every PoP.
const RESET_GENERATION_TTL_SECONDS = PASSWORD_RESET_TOKEN_EXPIRATION_SECONDS + 60;

const INVALID_TOKEN_ERROR = {
  code: "NOT_FOUND",
  message: { key: "Client.Auth.ResetPassword.errorInvalidToken" },
} as const;

const EXPIRED_TOKEN_ERROR = {
  code: "PRECONDITION_FAILED",
  message: { key: "Client.Auth.ResetPassword.errorTokenExpired" },
} as const;

export async function createPasswordResetToken(userId: string): Promise<string> {
  // Read the stamp before the write: a revoke that lands in between then outdates this link,
  // which fails closed.
  const generation = await readGeneration(userId);

  return createExpiringToken<PasswordResetTokenPayload>({
    key: getResetTokenKey,
    expiresInSeconds: PASSWORD_RESET_TOKEN_EXPIRATION_SECONDS,
    payload: { userId, generation },
  });
}

/** Throws the reset-form `ActionError` for a missing, expired, or revoked link. */
export async function getValidPasswordResetToken(
  token: string,
): Promise<PasswordResetTokenPayload> {
  const payload = await getValidExpiringToken<PasswordResetTokenPayload>({
    token,
    key: getResetTokenKey,
    notFoundError: INVALID_TOKEN_ERROR,
    expiredError: EXPIRED_TOKEN_ERROR,
  });

  if (!await isLinkCurrent(payload)) {
    throw new ActionError(INVALID_TOKEN_ERROR.code, INVALID_TOKEN_ERROR.message);
  }

  return payload;
}

export async function hasValidPasswordResetToken(token: string): Promise<boolean> {
  const result = await readExpiringToken<PasswordResetTokenPayload>({
    token,
    key: getResetTokenKey,
  });

  return result.status === "valid" && await isLinkCurrent(result.payload);
}

// One blind write, so concurrent revokes cannot undo each other. It outdates every link issued
// before it, including links from before this stamp existed.
export async function revokePasswordResetTokensOfUser(userId: string): Promise<void> {
  const kv = await getAuthKV();

  await kv.put(getGenerationKey(userId), createRandomId(), {
    expirationTtl: RESET_GENERATION_TTL_SECONDS,
  });
}

// A link from before this deploy has no `generation`, so the first revoke kills it too.
async function isLinkCurrent({
  userId,
  generation,
}: PasswordResetTokenPayload): Promise<boolean> {
  return isCurrentGeneration({ stamped: generation, generation: await readGeneration(userId) });
}

async function readGeneration(userId: string): Promise<string | null> {
  const kv = await getAuthKV();

  return kv.get(getGenerationKey(userId));
}

function getGenerationKey(userId: string): string {
  return `${APP_KV_PREFIXES.passwordResetGeneration}${userId}`;
}

interface PasswordResetTokenPayload extends ExpiringTokenPayload {
  /** The user's stamp at issue time; null when none existed. Absent on pre-stamp links. */
  generation?: string | null;
}
