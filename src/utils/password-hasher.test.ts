import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { hashPassword, verifyPassword } = await import("@/utils/password-hasher");

const FIXED_SALT = new Uint8Array([
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
  0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
]);
const LEGACY_PASSWORD_HASH =
  "00112233445566778899aabbccddeeff:74910295e41874e5826df4cff58a5284ec96d7fa21a38bc368f0be9b638ee303";

describe("password hashing", () => {
  test("creates a versioned PBKDF2-SHA-256 hash with the current parameters", async () => {
    const storedHash = await hashPassword({
      password: "correct horse battery staple",
      providedSalt: FIXED_SALT,
    });

    const [algorithm, iterations, salt, hash] = storedHash.split("$");
    expect(algorithm).toBe("pbkdf2-sha256");
    // Cloudflare's production runtime caps PBKDF2 at 100k iterations and local workerd does not,
    // so this assertion is the only thing standing between a raised value and a broken deploy.
    expect(iterations).toBe("100000");
    expect(salt).toBe("ABEiM0RVZneImaq7zN3u_w");
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("uses a cryptographically random 16-byte salt by default", async () => {
    const getRandomValues = vi.spyOn(globalThis.crypto, "getRandomValues");

    const firstHash = await hashPassword({ password: "same-password" });
    const secondHash = await hashPassword({ password: "same-password" });

    expect(getRandomValues).toHaveBeenCalled();
    expect(firstHash).not.toBe(secondHash);
    expect(firstHash.split("$")[2]).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(secondHash.split("$")[2]).toMatch(/^[A-Za-z0-9_-]{22}$/);

    getRandomValues.mockRestore();
  });

  test("verifies the current format without requesting a rehash", async () => {
    const storedHash = await hashPassword({
      password: "current-password",
      providedSalt: FIXED_SALT,
    });

    await expect(verifyPassword({
      storedHash,
      passwordAttempt: "current-password",
    })).resolves.toEqual({
      isValid: true,
      needsRehash: false,
      scheme: "pbkdf2-sha256",
    });

    await expect(verifyPassword({
      storedHash,
      passwordAttempt: "wrong-password",
    })).resolves.toEqual({
      isValid: false,
      needsRehash: false,
      scheme: "pbkdf2-sha256",
    });
  });

  test("verifies legacy 100,000-iteration hashes and requests a rehash", async () => {
    await expect(verifyPassword({
      storedHash: LEGACY_PASSWORD_HASH,
      passwordAttempt: "legacy-password",
    })).resolves.toEqual({
      isValid: true,
      needsRehash: true,
      scheme: "legacy-pbkdf2-sha256",
    });
  });

  test("accepts a stronger future iteration count without requesting a downgrade", async () => {
    const storedHash =
      "pbkdf2-sha256$700000$ABEiM0RVZneImaq7zN3u_w$SgtXryxPq4lS8mA9CPcDE3lfPiXvCU9C_4mguABIhWg";

    await expect(verifyPassword({
      storedHash,
      passwordAttempt: "future-password",
    })).resolves.toEqual({
      isValid: true,
      needsRehash: false,
      scheme: "pbkdf2-sha256",
    });
  });

  test.each([
    "",
    "not-a-password-hash",
    "0011:2233",
    `${"00".repeat(16)}:${"gg".repeat(32)}`,
    `${"00".repeat(16)}:${"11".repeat(32)}:extra`,
    "pbkdf2-sha256$0$ABEiM0RVZneImaq7zN3u_w$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "pbkdf2-sha256$100000$too-short$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "pbkdf2-sha256$100000$ABEiM0RVZneImaq7zN3u_w$invalid+base64",
    "unknown$100000$ABEiM0RVZneImaq7zN3u_w$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  ])("rejects malformed stored values without throwing: %s", async (storedHash) => {
    await expect(verifyPassword({
      storedHash,
      passwordAttempt: "password",
    })).resolves.toEqual({
      isValid: false,
      needsRehash: false,
      scheme: null,
    });
  });
});
