import "server-only";

import { getCloudflareContext } from "@/utils/cloudflare-context";
import { hashToken } from "@/utils/random-token";

// Shared primitive for expiring, hash-keyed KV records: bearer tokens and
// single-use WebAuthn challenges both store JSON under a digest of a secret,
// validate an ISO `expiresAt`, and delete on invalid/expired.

export interface HashedRecordPayload {
  expiresAt: string;
}

type HashedRecordResult<P extends HashedRecordPayload> =
  | { status: "valid"; payload: P }
  | { status: "expired" | "invalid" | "missing" };

interface PutHashedRecordParams<P extends HashedRecordPayload> {
  secret: string;
  deriveKey: (hash: string) => string;
  payload: Omit<P, "expiresAt">;
  expirationTtlSeconds: number;
}

interface ReadHashedRecordParams<P extends HashedRecordPayload> {
  secret: string;
  deriveKey: (hash: string) => string;
  validate?: (payload: P) => boolean;
}

interface DeleteHashedRecordParams {
  secret: string;
  deriveKey: (hash: string) => string;
}

async function getAuthKV() {
  const { env } = await getCloudflareContext();

  if (!env?.KV_STORE) {
    throw new Error("Can't connect to KV store");
  }

  return env.KV_STORE;
}

async function deriveStorageKey({
  secret,
  deriveKey,
}: DeleteHashedRecordParams): Promise<string> {
  return deriveKey(await hashToken(secret));
}

function evaluateHashedRecord<P extends HashedRecordPayload>({
  raw,
  validate,
}: {
  raw: string;
  validate?: (payload: P) => boolean;
}): HashedRecordResult<P> {
  try {
    const payload = JSON.parse(raw) as P;

    // Domain checks run first to preserve caller-visible "invalid" over
    // "expired" when both a payload field and the timestamp are bad.
    if (validate && !validate(payload)) {
      return { status: "invalid" };
    }

    const expiresAt = new Date(payload.expiresAt);

    if (Number.isNaN(expiresAt.getTime())) {
      return { status: "invalid" };
    }

    if (new Date() > expiresAt) {
      return { status: "expired" };
    }

    return { status: "valid", payload };
  } catch {
    return { status: "invalid" };
  }
}

export async function putHashedRecord<P extends HashedRecordPayload>({
  secret,
  deriveKey,
  payload,
  expirationTtlSeconds,
}: PutHashedRecordParams<P>): Promise<void> {
  const kv = await getAuthKV();
  const stored = {
    ...payload,
    expiresAt: new Date(Date.now() + expirationTtlSeconds * 1000).toISOString(),
  };

  await kv.put(
    await deriveStorageKey({ secret, deriveKey }),
    JSON.stringify(stored),
    { expirationTtl: expirationTtlSeconds },
  );
}

async function loadHashedRecord({
  secret,
  deriveKey,
}: DeleteHashedRecordParams) {
  const kv = await getAuthKV();
  const storageKey = await deriveStorageKey({ secret, deriveKey });
  const raw = await kv.get(storageKey);

  return { kv, storageKey, raw };
}

export async function readHashedRecord<P extends HashedRecordPayload>({
  secret,
  deriveKey,
  validate,
}: ReadHashedRecordParams<P>): Promise<HashedRecordResult<P>> {
  const { kv, storageKey, raw } = await loadHashedRecord({ secret, deriveKey });

  if (!raw) {
    return { status: "missing" };
  }

  const result = evaluateHashedRecord<P>({ raw, validate });

  if (result.status !== "valid") {
    await kv.delete(storageKey);
  }

  return result;
}

export async function consumeHashedRecord<P extends HashedRecordPayload>({
  secret,
  deriveKey,
  validate,
}: ReadHashedRecordParams<P>): Promise<HashedRecordResult<P>> {
  const { kv, storageKey, raw } = await loadHashedRecord({ secret, deriveKey });

  if (!raw) {
    return { status: "missing" };
  }

  // Cloudflare KV is eventually consistent, so this get-then-delete makes
  // single-use a soft guarantee (~60s cross-colo replay window). Delete before
  // validating so a bad payload still burns the record (fail-closed). Hard
  // atomicity would require D1 or a Durable Object.
  await kv.delete(storageKey);

  return evaluateHashedRecord<P>({ raw, validate });
}

export async function deleteHashedRecord({
  secret,
  deriveKey,
}: DeleteHashedRecordParams): Promise<void> {
  const kv = await getAuthKV();

  await kv.delete(await deriveStorageKey({ secret, deriveKey }));
}
