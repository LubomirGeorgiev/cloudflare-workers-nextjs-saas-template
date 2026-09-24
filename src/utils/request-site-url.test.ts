import { beforeEach, describe, expect, test, vi } from "vitest";

import { SITE_URL } from "@/constants";

import { __INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER } from "./request-protocol";

const headersMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

const { getRequestSiteUrl, resolveRequestSiteUrl } = await import("./request-site-url");

const SITE = "https://app.example.test";
const PREVIEW_ORIGIN = "https://preview-123.example-preview.test";

function resolve(entries: Record<string, string>, siteUrl = SITE): string {
  return resolveRequestSiteUrl({ requestHeaders: new Headers(entries), siteUrl });
}

describe("resolveRequestSiteUrl", () => {
  test("uses the Origin header of the request", () => {
    expect(resolve({ origin: PREVIEW_ORIGIN, host: "ignored.example.test" })).toBe(PREVIEW_ORIGIN);
  });

  test("builds the origin from the Host and the Worker-set protocol without an Origin header", () => {
    expect(resolve({
      host: "localhost:5173",
      [__INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER]: "http",
    })).toBe("http://localhost:5173");
  });

  // A client can set x-forwarded-proto; only the Worker-set protocol counts.
  test("ignores x-forwarded-proto", () => {
    expect(resolve({ host: "preview.example.test", "x-forwarded-proto": "https" })).toBe(SITE);
  });

  test("keeps the base path of the site URL", () => {
    expect(resolve({ origin: PREVIEW_ORIGIN }, `${SITE}/app/`)).toBe(`${PREVIEW_ORIGIN}/app`);
  });

  test.each([
    ["no headers", {}],
    ["an opaque origin", { origin: "null" }],
    ["a non-http origin", { origin: "javascript:alert(1)" }],
    ["a file origin", { origin: "file:///etc/passwd" }],
    ["an origin with a path", { origin: `${PREVIEW_ORIGIN}/evil` }],
    ["an origin with user info", { origin: "https://user@evil.example.test" }],
    ["an unparsable host", { host: "exa mple.test", [__INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER]: "https" }],
    ["a host with user info", { host: "app.example.test@evil.example.test", [__INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER]: "https" }],
  ])("falls back to the site URL for %s", (_label, entries: Record<string, string>) => {
    expect(resolve(entries)).toBe(SITE);
  });
});

describe("getRequestSiteUrl", () => {
  beforeEach(() => {
    headersMock.mockReset();
  });

  test("reads the request headers", async () => {
    headersMock.mockResolvedValue(new Headers({ origin: PREVIEW_ORIGIN }));

    await expect(getRequestSiteUrl()).resolves.toBe(PREVIEW_ORIGIN);
  });

  test("falls back to SITE_URL", async () => {
    headersMock.mockResolvedValue(new Headers());

    await expect(getRequestSiteUrl()).resolves.toBe(SITE_URL);
  });
});
