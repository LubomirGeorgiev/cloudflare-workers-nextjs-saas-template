import "server-only";

import { timingSafeEqual } from "node:crypto";

import {
  decodeBase64urlIgnorePadding,
  encodeBase64urlNoPadding,
} from "@oslojs/encoding";

const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
// Cloudflare's production runtime rejects PBKDF2 above 100k iterations (workerd's
// IsolateLimitEnforcer default); local workerd does not enforce it, so a higher value here passes
// dev and CI and only fails after deploy. https://github.com/cloudflare/workerd/issues/1346
const PASSWORD_HASH_ITERATIONS = 100_000;
const LEGACY_PASSWORD_HASH_ITERATIONS = 100_000;
const PASSWORD_HASH_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;
const MAX_PASSWORD_SALT_BYTES = 64;
const MAX_STORED_PASSWORD_HASH_LENGTH = 256;

interface HashPasswordParams {
  password: string;
  providedSalt?: Uint8Array<ArrayBuffer>;
}

interface DerivePasswordHashParams {
  iterations: number;
  password: string;
  salt: Uint8Array<ArrayBuffer>;
}

interface VerifyPasswordParams {
  storedHash: string;
  passwordAttempt: string;
}

type PasswordHashScheme =
  | typeof PASSWORD_HASH_ALGORITHM
  | "legacy-pbkdf2-sha256";

interface VerifyPasswordResult {
  isValid: boolean;
  needsRehash: boolean;
  scheme: PasswordHashScheme | null;
}

interface ParsedPasswordHash {
  hash: Uint8Array<ArrayBuffer>;
  iterations: number;
  needsRehash: boolean;
  salt: Uint8Array<ArrayBuffer>;
  scheme: PasswordHashScheme;
}

async function derivePasswordHash({
  iterations,
  password,
  salt,
}: DerivePasswordHashParams): Promise<Uint8Array<ArrayBuffer>> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    PASSWORD_HASH_BYTES * 8,
  );

  return new Uint8Array(hash);
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  try {
    const decoded = new Uint8Array(decodeBase64urlIgnorePadding(value));

    // Reject alternate, non-canonical encodings of the same bytes.
    return encodeBase64urlNoPadding(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
}

function decodeHex(value: string): Uint8Array<ArrayBuffer> | null {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    return null;
  }

  const decoded = new Uint8Array(value.length / 2);
  for (let index = 0; index < decoded.length; index += 1) {
    decoded[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }

  return decoded;
}

function parsePasswordHashIterations(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const iterations = Number(value);

  return Number.isSafeInteger(iterations) ? iterations : null;
}

interface VersionedHashBytes {
  hash: Uint8Array<ArrayBuffer> | null;
  salt: Uint8Array<ArrayBuffer> | null;
}

function hasValidVersionedHashBytes(
  bytes: VersionedHashBytes,
): bytes is {
  hash: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
} {
  return (
    bytes.salt !== null
    && bytes.salt.byteLength >= PASSWORD_SALT_BYTES
    && bytes.salt.byteLength <= MAX_PASSWORD_SALT_BYTES
    && bytes.hash !== null
    && bytes.hash.byteLength === PASSWORD_HASH_BYTES
  );
}

function parseVersionedPasswordHash(storedHash: string): ParsedPasswordHash | null {
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== PASSWORD_HASH_ALGORITHM) {
    return null;
  }

  const iterations = parsePasswordHashIterations(parts[1]);
  if (iterations === null) {
    return null;
  }

  const bytes = {
    salt: decodeBase64Url(parts[2] ?? ""),
    hash: decodeBase64Url(parts[3] ?? ""),
  };
  if (!hasValidVersionedHashBytes(bytes)) {
    return null;
  }

  return {
    hash: bytes.hash,
    iterations,
    needsRehash: iterations < PASSWORD_HASH_ITERATIONS,
    salt: bytes.salt,
    scheme: PASSWORD_HASH_ALGORITHM,
  };
}

function parseLegacyPasswordHash(storedHash: string): ParsedPasswordHash | null {
  const [saltValue, hashValue, extra] = storedHash.split(":");
  if (extra !== undefined) {
    return null;
  }

  const salt = decodeHex(saltValue ?? "");
  const hash = decodeHex(hashValue ?? "");
  if (
    salt?.byteLength !== PASSWORD_SALT_BYTES
    || hash?.byteLength !== PASSWORD_HASH_BYTES
  ) {
    return null;
  }

  return {
    hash,
    iterations: LEGACY_PASSWORD_HASH_ITERATIONS,
    needsRehash: true,
    salt,
    scheme: "legacy-pbkdf2-sha256",
  };
}

function parsePasswordHash(storedHash: string): ParsedPasswordHash | null {
  if (
    storedHash.length === 0
    || storedHash.length > MAX_STORED_PASSWORD_HASH_LENGTH
  ) {
    return null;
  }

  return storedHash.startsWith(`${PASSWORD_HASH_ALGORITHM}$`)
    ? parseVersionedPasswordHash(storedHash)
    : parseLegacyPasswordHash(storedHash);
}

async function hashPassword({
  password,
  providedSalt,
}: HashPasswordParams): Promise<string> {
  const salt = providedSalt ?? crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  if (
    salt.byteLength < PASSWORD_SALT_BYTES
    || salt.byteLength > MAX_PASSWORD_SALT_BYTES
  ) {
    throw new RangeError(
      `Password salt must be between ${PASSWORD_SALT_BYTES} and ${MAX_PASSWORD_SALT_BYTES} bytes`,
    );
  }

  const hash = await derivePasswordHash({
    iterations: PASSWORD_HASH_ITERATIONS,
    password,
    salt,
  });

  return [
    PASSWORD_HASH_ALGORITHM,
    PASSWORD_HASH_ITERATIONS,
    encodeBase64urlNoPadding(salt),
    encodeBase64urlNoPadding(hash),
  ].join("$");
}

async function verifyPassword({
  storedHash,
  passwordAttempt,
}: VerifyPasswordParams): Promise<VerifyPasswordResult> {
  const parsedHash = parsePasswordHash(storedHash);
  if (parsedHash === null) {
    return { isValid: false, needsRehash: false, scheme: null };
  }

  const attemptedHash = await derivePasswordHash({
    iterations: parsedHash.iterations,
    password: passwordAttempt,
    salt: parsedHash.salt,
  });
  const isValid = timingSafeEqual(attemptedHash, parsedHash.hash);

  return {
    isValid,
    needsRehash: isValid && parsedHash.needsRehash,
    scheme: parsedHash.scheme,
  };
}

export {
  hashPassword,
  verifyPassword,
};
