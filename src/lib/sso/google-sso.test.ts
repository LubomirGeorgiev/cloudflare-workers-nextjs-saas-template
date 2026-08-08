import { encodeBase64urlNoPadding } from "@oslojs/encoding";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SITE_URL } from "@/constants";
import {
  createGoogleAuthorizationURL,
  generateCodeVerifier,
  generateState,
  parseGoogleIdToken,
  validateGoogleAuthorizationCode,
  type GoogleIdTokenClaims,
} from "@/lib/sso/google-sso";

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const CLIENT_SECRET = "test-client-secret";

function encodeJsonSegment(value: unknown): string {
  return encodeBase64urlNoPadding(new TextEncoder().encode(JSON.stringify(value)));
}

function createIdToken(claims: Partial<GoogleIdTokenClaims>): string {
  const nowSeconds = Math.floor(Date.now() / 1000);

  const payload: GoogleIdTokenClaims = {
    iss: "https://accounts.google.com",
    azp: CLIENT_ID,
    aud: CLIENT_ID,
    sub: "1234567890",
    email: "user@example.com",
    email_verified: true,
    iat: nowSeconds - 10,
    exp: nowSeconds + 3600,
    ...claims,
  };

  return [
    encodeJsonSegment({ alg: "RS256", typ: "JWT" }),
    encodeJsonSegment(payload),
    "signature-not-verified",
  ].join(".");
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", CLIENT_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("google sso secrets", () => {
  test("generates URL-safe state and code verifier of the PKCE minimum length", () => {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();

    for (const secret of [state, codeVerifier]) {
      expect(secret).toHaveLength(43);
      expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    }

    expect(state).not.toBe(codeVerifier);
  });
});

describe("createGoogleAuthorizationURL", () => {
  test("builds an authorization code request with an S256 challenge", async () => {
    const codeVerifier = generateCodeVerifier();

    const url = await createGoogleAuthorizationURL({ state: "state-value", codeVerifier });

    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(`${SITE_URL}/sso/google/callback`);
    expect(url.searchParams.get("scope")?.split(" ")).toContain("openid");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      encodeBase64urlNoPadding(new Uint8Array(digest))
    );
    // The verifier itself must never leave the server.
    expect(url.toString()).not.toContain(codeVerifier);
  });
});

describe("validateGoogleAuthorizationCode", () => {
  test("posts the code and verifier to the token endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ id_token: "id-token-value" })
    );

    const idToken = await validateGoogleAuthorizationCode({
      code: "auth-code",
      codeVerifier: "verifier",
    });

    expect(idToken).toBe("id-token-value");

    const [requestUrl, requestInit] = fetchMock.mock.calls[0];
    const body = new URLSearchParams(requestInit?.body as string);

    expect(requestUrl).toBe("https://oauth2.googleapis.com/token");
    expect(requestInit?.method).toBe("POST");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("code_verifier")).toBe("verifier");
    expect(body.get("client_secret")).toBe(CLIENT_SECRET);
    expect(body.get("redirect_uri")).toBe(`${SITE_URL}/sso/google/callback`);
  });

  test("throws when the token endpoint rejects the exchange", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("invalid_grant", { status: 400 })
    );

    await expect(
      validateGoogleAuthorizationCode({ code: "auth-code", codeVerifier: "verifier" })
    ).rejects.toThrow(/400/);
  });

  test("throws when the token response carries no ID token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ access_token: "only-access" }));

    await expect(
      validateGoogleAuthorizationCode({ code: "auth-code", codeVerifier: "verifier" })
    ).rejects.toThrow(/ID token/);
  });
});

describe("parseGoogleIdToken", () => {
  test("returns the claims of a well-formed token", () => {
    const claims = parseGoogleIdToken(createIdToken({ name: "Test User" }));

    expect(claims.sub).toBe("1234567890");
    expect(claims.email).toBe("user@example.com");
    expect(claims.name).toBe("Test User");
  });

  test("accepts the scheme-less issuer Google also mints", () => {
    expect(() => parseGoogleIdToken(createIdToken({ iss: "accounts.google.com" }))).not.toThrow();
  });

  test.each([
    ["a foreign issuer", { iss: "https://evil.example.com" }],
    ["another OAuth client audience", { aud: "other-client-id" }],
    ["a mismatched authorized party", { azp: "other-client-id" }],
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ["a token issued in the future", { iat: Math.floor(Date.now() / 1000) + 3600 }],
    ["a missing subject", { sub: "" }],
    ["a missing email", { email: "" }],
  ])("rejects %s", (_label, claims) => {
    expect(() => parseGoogleIdToken(createIdToken(claims))).toThrow();
  });

  test("rejects a malformed token", () => {
    expect(() => parseGoogleIdToken("not-a-jwt")).toThrow(/Malformed/);
  });

  test("tolerates clock skew within a minute", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    expect(() =>
      parseGoogleIdToken(createIdToken({ exp: nowSeconds - 30, iat: nowSeconds + 30 }))
    ).not.toThrow();
  });
});
