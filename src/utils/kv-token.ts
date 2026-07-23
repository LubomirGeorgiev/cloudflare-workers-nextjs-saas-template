import "server-only";

import { ActionError, type ActionErrorMessage } from "@/lib/action-error";
import {
  deleteHashedRecord,
  type HashedRecordPayload,
  putHashedRecord,
  readHashedRecord,
} from "@/utils/kv-record";
import { createBase64UrlToken } from "@/utils/random-token";

const EXPIRING_TOKEN_BYTES = 32;

interface ExpiringTokenPayload extends HashedRecordPayload {
  userId: string;
}

interface TokenActionError {
  code: string;
  // Keyed messages are preferred (translated centrally in safe-action).
  message: ActionErrorMessage;
}

interface CreateExpiringTokenParams {
  key: (token: string) => string;
  expiresInSeconds: number;
  payload: Omit<ExpiringTokenPayload, "expiresAt">;
}

interface GetValidExpiringTokenParams {
  token: string;
  key: (token: string) => string;
  notFoundError: TokenActionError;
  expiredError?: TokenActionError;
}

interface DeleteExpiringTokenParams {
  token: string;
  key: (token: string) => string;
}

interface HasValidExpiringTokenParams {
  token: string;
  key: (token: string) => string;
}

function toActionError(error: TokenActionError): ActionError {
  return new ActionError(error.code, error.message);
}

function hasUserId(payload: ExpiringTokenPayload): boolean {
  return Boolean(payload.userId);
}

export async function createExpiringToken({
  key,
  expiresInSeconds,
  payload,
}: CreateExpiringTokenParams): Promise<string> {
  const token = createBase64UrlToken(EXPIRING_TOKEN_BYTES);

  await putHashedRecord<ExpiringTokenPayload>({
    secret: token,
    deriveKey: key,
    payload,
    expirationTtlSeconds: expiresInSeconds,
  });

  return token;
}

export async function getValidExpiringToken({
  token,
  key,
  notFoundError,
  expiredError = notFoundError,
}: GetValidExpiringTokenParams): Promise<ExpiringTokenPayload> {
  const result = await readHashedRecord<ExpiringTokenPayload>({
    secret: token,
    deriveKey: key,
    validate: hasUserId,
  });

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
}: DeleteExpiringTokenParams): Promise<void> {
  await deleteHashedRecord({ secret: token, deriveKey: key });
}

// Not single-use: the reset flow reads on page view and consumes later, so a
// valid entry is left in place; only invalid/expired entries are cleaned up.
export async function hasValidExpiringToken({
  token,
  key,
}: HasValidExpiringTokenParams): Promise<boolean> {
  const result = await readHashedRecord<ExpiringTokenPayload>({
    secret: token,
    deriveKey: key,
    validate: hasUserId,
  });

  return result.status === "valid";
}
