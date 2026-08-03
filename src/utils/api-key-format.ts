import {
  API_KEY_PREFIX_LIVE,
  API_KEY_PREFIX_TEST,
  API_KEY_SECRET_BYTES,
} from "@/constants";
import { hashToken } from "@/utils/random-token";

// Wire format: {prefix}{base62(random bytes)}{base62(crc32(body), 6 chars)}.
// The checksum is GitHub's trick: a malformed or truncated key is rejected offline, so garbage
// bearer tokens never reach D1 or KV. It is integrity, not authentication — the secret still is.
const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE62_RADIX = BigInt(BASE62_ALPHABET.length);
const CHECKSUM_LENGTH = 6;
// 32 random bytes never encode to fewer than this many base62 chars unless the leading bytes are
// zero; the floor only has to reject obviously-truncated input, so it stays deliberately loose.
const MIN_BODY_LENGTH = 32;
const CRC32_POLYNOMIAL = 0xedb88320;

export const API_KEY_PREFIXES = [API_KEY_PREFIX_LIVE, API_KEY_PREFIX_TEST] as const;

interface GeneratedApiKey {
  /** The only time the full secret exists; it is shown once and never stored. */
  secret: string;
  hash: string;
  prefix: string;
  last4: string;
}

let crc32Table: Uint32Array | undefined;

function getCrc32Table(): Uint32Array {
  if (crc32Table) {
    return crc32Table;
  }

  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? (value >>> 1) ^ CRC32_POLYNOMIAL : value >>> 1;
    }
    table[i] = value >>> 0;
  }

  crc32Table = table;
  return table;
}

export function crc32(input: string): number {
  const table = getCrc32Table();
  const bytes = new TextEncoder().encode(input);
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

export function encodeBase62(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }

  if (value === 0n) {
    return BASE62_ALPHABET[0];
  }

  let encoded = "";
  while (value > 0n) {
    encoded = BASE62_ALPHABET[Number(value % BASE62_RADIX)] + encoded;
    value /= BASE62_RADIX;
  }

  return encoded;
}

function encodeBase62Fixed({ value, length }: { value: number; length: number }): string {
  let remaining = value;
  let encoded = "";

  for (let i = 0; i < length; i++) {
    encoded = BASE62_ALPHABET[remaining % BASE62_ALPHABET.length] + encoded;
    remaining = Math.floor(remaining / BASE62_ALPHABET.length);
  }

  return encoded;
}

function createBase62Token(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);

  return encodeBase62(bytes);
}

function checksumFor(body: string): string {
  return encodeBase62Fixed({ value: crc32(body), length: CHECKSUM_LENGTH });
}

export async function generateApiKey({
  prefix = API_KEY_PREFIX_LIVE,
}: { prefix?: string } = {}): Promise<GeneratedApiKey> {
  const body = createBase62Token(API_KEY_SECRET_BYTES);
  const secret = `${prefix}${body}${checksumFor(body)}`;

  return {
    secret,
    hash: await hashToken(secret),
    prefix,
    last4: secret.slice(-4),
  };
}

function matchPrefix(token: string): string | undefined {
  return API_KEY_PREFIXES.find((candidate) => token.startsWith(candidate));
}

// Cheap offline gate for the auth hot path: wrong shape or broken checksum means no storage
// lookup at all. A `true` result says only "this could be one of ours", never "this is valid".
export function looksLikeApiKey(token: string): boolean {
  const prefix = matchPrefix(token);
  if (!prefix) {
    return false;
  }

  const remainder = token.slice(prefix.length);
  if (remainder.length < MIN_BODY_LENGTH + CHECKSUM_LENGTH) {
    return false;
  }

  const body = remainder.slice(0, -CHECKSUM_LENGTH);
  const checksum = remainder.slice(-CHECKSUM_LENGTH);

  for (const character of remainder) {
    if (!BASE62_ALPHABET.includes(character)) {
      return false;
    }
  }

  return checksum === checksumFor(body);
}

// Display form for a key whose secret is long gone: `saas_live_…a1b2`.
export function formatApiKeyHint({ keyPrefix, last4 }: { keyPrefix: string; last4: string }): string {
  return `${keyPrefix}…${last4}`;
}
