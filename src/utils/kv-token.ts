import "server-only";

import { ActionError, type ActionErrorMessage } from "@/lib/action-error";
import {
  deleteHashedRecord,
  type HashedRecordPayload,
  type HashedRecordResult,
  putHashedRecord,
  readHashedRecord,
} from "@/utils/kv-record";
import { createBase64UrlToken } from "@/utils/random-token";

const EXPIRING_TOKEN_BYTES = 32;

export interface ExpiringTokenPayload extends HashedRecordPayload {
  userId: string;
}

interface TokenActionError {
  code: string;
  // Keyed messages are preferred (translated centrally in safe-action).
  message: ActionErrorMessage;
}

interface CreateExpiringTokenParams<P extends ExpiringTokenPayload> {
  key: (token: string) => string;
  expiresInSeconds: number;
  payload: Omit<P, "expiresAt">;
}

interface ExpiringTokenParams {
  token: string;
  key: (token: string) => string;
}

interface GetValidExpiringTokenParams extends ExpiringTokenParams {
  notFoundError: TokenActionError;
  expiredError?: TokenActionError;
}

function toActionError(error: TokenActionError): ActionError {
  return new ActionError(error.code, error.message);
}

function hasUserId(payload: ExpiringTokenPayload): boolean {
  return Boolean(payload.userId);
}

export async function createExpiringToken<P extends ExpiringTokenPayload = ExpiringTokenPayload>({
  key,
  expiresInSeconds,
  payload,
}: CreateExpiringTokenParams<P>): Promise<string> {
  const token = createBase64UrlToken(EXPIRING_TOKEN_BYTES);

  await putHashedRecord<P>({
    secret: token,
    deriveKey: key,
    payload,
    expirationTtlSeconds: expiresInSeconds,
  });

  return token;
}

// Not single-use: the reset flow reads on page view and consumes later, so a
// valid entry is left in place; only invalid/expired entries are cleaned up.
export function readExpiringToken<P extends ExpiringTokenPayload = ExpiringTokenPayload>({
  token,
  key,
}: ExpiringTokenParams): Promise<HashedRecordResult<P>> {
  return readHashedRecord<P>({ secret: token, deriveKey: key, validate: hasUserId });
}

export async function getValidExpiringToken<P extends ExpiringTokenPayload = ExpiringTokenPayload>({
  token,
  key,
  notFoundError,
  expiredError = notFoundError,
}: GetValidExpiringTokenParams): Promise<P> {
  const result = await readExpiringToken<P>({ token, key });

  if (result.status === "valid") {
    return result.payload;
  }

  throw toActionError(
    result.status === "expired" ? expiredError : notFoundError,
  );
}

export async function deleteExpiringToken({
  token,
  key,
}: ExpiringTokenParams): Promise<void> {
  await deleteHashedRecord({ secret: token, deriveKey: key });
}
