import { describe, expect, test } from "vitest";

import { API_KEY_PREFIX_LIVE, API_KEY_PREFIX_TEST } from "@/constants";
import {
  API_KEY_PREFIXES,
  crc32,
  encodeBase62,
  formatApiKeyHint,
  generateApiKey,
  looksLikeApiKey,
} from "@/utils/api-key-format";

// Prefixes are template-rebrandable, so every assertion derives from the constants rather than
// hard-coding the shipped values.
const BASE62_PATTERN = /^[0-9A-Za-z]+$/;

describe("encodeBase62", () => {
  test("encodes zero and single-digit values", () => {
    expect(encodeBase62(new Uint8Array([0]))).toBe("0");
    expect(encodeBase62(new Uint8Array([61]))).toBe("z");
  });

  test("carries across digits", () => {
    // 0x0100 = 256 = 4 * 62 + 8
    expect(encodeBase62(new Uint8Array([1, 0]))).toBe("48");
  });

  test("only ever emits base62 characters", () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);

    expect(encodeBase62(bytes)).toMatch(BASE62_PATTERN);
  });
});

describe("crc32", () => {
  test("matches the standard check vector", () => {
    expect(crc32("123456789")).toBe(0xcbf43926);
  });

  test("differs for a single-character change", () => {
    expect(crc32("abc")).not.toBe(crc32("abd"));
  });
});

describe("generateApiKey", () => {
  test("round-trips through the offline checksum gate", async () => {
    const generated = await generateApiKey();

    expect(generated.secret.startsWith(API_KEY_PREFIX_LIVE)).toBe(true);
    expect(generated.prefix).toBe(API_KEY_PREFIX_LIVE);
    expect(generated.last4).toBe(generated.secret.slice(-4));
    expect(generated.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(looksLikeApiKey(generated.secret)).toBe(true);
  });

  test("honors an alternate prefix", async () => {
    const generated = await generateApiKey({ prefix: API_KEY_PREFIX_TEST });

    expect(generated.secret.startsWith(API_KEY_PREFIX_TEST)).toBe(true);
    expect(looksLikeApiKey(generated.secret)).toBe(true);
  });

  test("never repeats a secret", async () => {
    const [first, second] = await Promise.all([generateApiKey(), generateApiKey()]);

    expect(first.secret).not.toBe(second.secret);
    expect(first.hash).not.toBe(second.hash);
  });

  test("the hash is a digest, not the secret", async () => {
    const generated = await generateApiKey();

    expect(generated.hash).not.toContain(generated.secret);
    expect(generated.secret).not.toContain(generated.hash);
  });
});

describe("looksLikeApiKey", () => {
  test("rejects garbage without touching storage", () => {
    expect(looksLikeApiKey("")).toBe(false);
    expect(looksLikeApiKey("not-a-key")).toBe(false);
    expect(looksLikeApiKey("Bearer abc")).toBe(false);
  });

  test("rejects a known prefix with a random body", () => {
    expect(looksLikeApiKey(`${API_KEY_PREFIX_LIVE}${"a".repeat(48)}`)).toBe(false);
  });

  test("rejects a valid key whose prefix was swapped for an unknown one", async () => {
    const { secret } = await generateApiKey();

    expect(looksLikeApiKey(secret.replace(API_KEY_PREFIX_LIVE, "wrong_"))).toBe(false);
  });

  test("rejects a mutated body", async () => {
    const { secret } = await generateApiKey();
    const index = API_KEY_PREFIX_LIVE.length;
    const mutatedCharacter = secret[index] === "a" ? "b" : "a";
    const mutated = secret.slice(0, index) + mutatedCharacter + secret.slice(index + 1);

    expect(mutated).not.toBe(secret);
    expect(looksLikeApiKey(mutated)).toBe(false);
  });

  test("rejects a mutated checksum", async () => {
    const { secret } = await generateApiKey();
    const lastCharacter = secret.at(-1) === "a" ? "b" : "a";

    expect(looksLikeApiKey(secret.slice(0, -1) + lastCharacter)).toBe(false);
  });

  test("rejects truncation and non-base62 characters", async () => {
    const { secret } = await generateApiKey();

    expect(looksLikeApiKey(secret.slice(0, -1))).toBe(false);
    expect(looksLikeApiKey(`${secret.slice(0, -1)}-`)).toBe(false);
    expect(looksLikeApiKey(`${API_KEY_PREFIX_LIVE}short`)).toBe(false);
  });

  test("every configured prefix is recognized", async () => {
    for (const prefix of API_KEY_PREFIXES) {
      const { secret } = await generateApiKey({ prefix });
      expect(looksLikeApiKey(secret)).toBe(true);
    }
  });
});

test("formatApiKeyHint shows only the prefix and the last four characters", async () => {
  const generated = await generateApiKey();
  const hint = formatApiKeyHint({ keyPrefix: generated.prefix, last4: generated.last4 });

  expect(hint.startsWith(generated.prefix)).toBe(true);
  expect(hint.endsWith(generated.last4)).toBe(true);
  expect(generated.secret.includes(hint)).toBe(false);
});
