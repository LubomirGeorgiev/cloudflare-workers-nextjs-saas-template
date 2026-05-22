import "server-only";

import { ActionError } from "@/lib/action-error";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import { createId } from "@paralleldrive/cuid2";

interface ExpiringTokenPayload {
  userId: string;
  expiresAt: string;
}

interface TokenActionError {
  code: string;
  message: string;
}

interface CreateExpiringTokenParams {
  key: (token: string) => string;
  expiresInSeconds: number;
  payload: Omit<ExpiringTokenPayload, "expiresAt">;
  createToken?: () => string;
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

async function getTokenKV() {
  const { env } = await getCloudflareContext();

  if (!env?.NEXT_INC_CACHE_KV) {
    throw new Error("Can't connect to KV store");
  }

  return env.NEXT_INC_CACHE_KV;
}

function toActionError(error: TokenActionError): ActionError {
  return new ActionError(error.code, error.message);
}

export async function createExpiringToken({
  key,
  expiresInSeconds,
  payload,
  createToken = createId,
}: CreateExpiringTokenParams): Promise<string> {
  const kv = await getTokenKV();
  const token = createToken();
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  await kv.put(
    key(token),
    JSON.stringify({
      ...payload,
      expiresAt: expiresAt.toISOString(),
    }),
    {
      expirationTtl: expiresInSeconds,
    }
  );

  return token;
}

export async function getValidExpiringToken({
  token,
  key,
  notFoundError,
  expiredError = notFoundError,
}: GetValidExpiringTokenParams): Promise<ExpiringTokenPayload> {
  const kv = await getTokenKV();
  const tokenString = await kv.get(key(token));

  if (!tokenString) {
    throw toActionError(notFoundError);
  }

  let payload: ExpiringTokenPayload;

  try {
    payload = JSON.parse(tokenString) as ExpiringTokenPayload;
  } catch {
    await kv.delete(key(token));
    throw toActionError(notFoundError);
  }

  if (!payload.userId || !payload.expiresAt) {
    await kv.delete(key(token));
    throw toActionError(notFoundError);
  }

  const expiresAt = new Date(payload.expiresAt);

  if (Number.isNaN(expiresAt.getTime())) {
    await kv.delete(key(token));
    throw toActionError(notFoundError);
  }

  if (new Date() > expiresAt) {
    await kv.delete(key(token));
    throw toActionError(expiredError);
  }

  return payload;
}

export async function deleteExpiringToken({
  token,
  key,
}: DeleteExpiringTokenParams): Promise<void> {
  const kv = await getTokenKV();

  await kv.delete(key(token));
}
