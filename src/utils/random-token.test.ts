import { describe, expect, test, vi } from "vitest";

import {
  createBase64UrlToken,
  createHexId,
  createRandomId,
  hashToken,
} from "@/utils/random-token";

describe("random token utilities", () => {
  test("creates URL-safe tokens with Web Crypto", () => {
    const getRandomValues = vi.spyOn(globalThis.crypto, "getRandomValues");

    const token = createBase64UrlToken(32);

    expect(getRandomValues).toHaveBeenCalled();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("creates 144-bit opaque IDs", () => {
    const id = createRandomId();

    expect(id).toHaveLength(24);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("creates lowercase-hex IDs of the requested byte length", () => {
    const getRandomValues = vi.spyOn(globalThis.crypto, "getRandomValues");

    const id = createHexId(3);

    expect(getRandomValues).toHaveBeenCalled();
    expect(id).toHaveLength(6);
    expect(id).toMatch(/^[a-f0-9]+$/);
  });

  test("hashes bearer tokens to stable SHA-256 digests", async () => {
    await expect(hashToken("raw-bearer-token")).resolves.toBe(
      "bd835450997dfc19d3b9a9c19e971dd15d951285acef0f7dd452916e26c8a863",
    );
  });
});
