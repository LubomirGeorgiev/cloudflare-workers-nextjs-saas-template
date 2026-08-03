import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { inspectOAuthTokenRateLimitIdentity } from "@/lib/oauth/token-rate-limit";

const TOKEN_URL = "https://example.com/oauth/token";

function formRequest(values: Record<string, string>): Request {
  return new Request(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
}

describe("OAuth token rate-limit identity", () => {
  test("uses one stable digest across authorization-code and refresh-token secrets", async () => {
    const authorizationCode = await inspectOAuthTokenRateLimitIdentity(formRequest({
      grant_type: "authorization_code",
      code: "user-1:grant-1:one-time-code-secret",
      client_id: "client-a",
      client_secret: "must-not-be-fingerprinted",
    }));
    const refreshToken = await inspectOAuthTokenRateLimitIdentity(formRequest({
      grant_type: "refresh_token",
      refresh_token: "user-1:grant-1:rotated-refresh-secret",
      client_id: "client-a",
      client_secret: "different-secret",
    }));

    expect(authorizationCode.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(refreshToken.fingerprint).toBe(authorizationCode.fingerprint);
    expect(authorizationCode.fingerprint).not.toContain("user-1");
    expect(authorizationCode.fingerprint).not.toContain("grant-1");
    expect(authorizationCode.isRevocationRequest).toBe(false);
  });

  test("separates different grants for the same client", async () => {
    const first = await inspectOAuthTokenRateLimitIdentity(formRequest({
      grant_type: "refresh_token",
      refresh_token: "user-1:grant-1:secret",
      client_id: "shared-client",
    }));
    const second = await inspectOAuthTokenRateLimitIdentity(formRequest({
      grant_type: "refresh_token",
      refresh_token: "user-1:grant-2:secret",
      client_id: "shared-client",
    }));

    expect(first.fingerprint).not.toBe(second.fingerprint);
  });

  test("falls back to a hashed client ID when no provider grant prefix is available", async () => {
    const first = await inspectOAuthTokenRateLimitIdentity(formRequest({
      grant_type: "refresh_token",
      refresh_token: "malformed-token",
      client_id: "https://client.example/oauth-metadata.json",
      client_secret: "ignored-secret-a",
    }));
    const second = await inspectOAuthTokenRateLimitIdentity(formRequest({
      grant_type: "refresh_token",
      refresh_token: "another-malformed-token",
      client_id: "https://client.example/oauth-metadata.json",
      client_secret: "ignored-secret-b",
    }));

    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(first.fingerprint).not.toContain("client.example");
  });

  test("recognizes only token-without-grant_type as RFC 7009 revocation", async () => {
    const revocation = await inspectOAuthTokenRateLimitIdentity(formRequest({
      token: "user-1:grant-1:token-secret",
      token_type_hint: "refresh_token",
      client_id: "client-a",
    }));
    const issuance = await inspectOAuthTokenRateLimitIdentity(formRequest({
      grant_type: "refresh_token",
      refresh_token: "user-1:grant-1:token-secret",
      token: "user-1:grant-1:token-secret",
      client_id: "client-a",
    }));

    expect(revocation).toEqual({ isRevocationRequest: true, fingerprint: null });
    expect(issuance.isRevocationRequest).toBe(false);
    expect(issuance.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  test("falls back to IP-only classification for oversized forms", async () => {
    const result = await inspectOAuthTokenRateLimitIdentity(formRequest({
      grant_type: "refresh_token",
      refresh_token: `user-1:grant-1:${"x".repeat(17 * 1024)}`,
      client_id: "client-a",
    }));

    expect(result).toEqual({ isRevocationRequest: false, fingerprint: null });
  });

  test("does not trust duplicate form fields for revocation or identity", async () => {
    const request = new Request(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "token=first&token=second&client_id=client-a&client_id=client-b",
    });

    await expect(inspectOAuthTokenRateLimitIdentity(request)).resolves.toEqual({
      isRevocationRequest: false,
      fingerprint: null,
    });
  });
});
