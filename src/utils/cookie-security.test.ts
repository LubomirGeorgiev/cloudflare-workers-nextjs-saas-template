import { beforeEach, describe, expect, test, vi } from "vitest";

import { __INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER } from "./request-protocol";

const headersMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

const { shouldUseSecureCookies } = await import("./cookie-security");

describe("secure cookie policy", () => {
  beforeEach(() => {
    headersMock.mockReset();
  });

  test("allows cookies over a trusted local HTTP request", async () => {
    headersMock.mockResolvedValue(new Headers({
      [__INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER]: "http",
    }));

    await expect(shouldUseSecureCookies()).resolves.toBe(false);
  });

  test("keeps cookies secure over HTTPS", async () => {
    headersMock.mockResolvedValue(new Headers({
      [__INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER]: "https",
    }));

    await expect(shouldUseSecureCookies()).resolves.toBe(true);
  });

  test("defaults to secure when trusted protocol context is unavailable", async () => {
    headersMock.mockResolvedValue(new Headers());

    await expect(shouldUseSecureCookies()).resolves.toBe(true);
  });
});
