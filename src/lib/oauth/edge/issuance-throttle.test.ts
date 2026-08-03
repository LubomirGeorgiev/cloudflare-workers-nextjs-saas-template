import { describe, expect, test, vi } from "vitest";

import { OAUTH_REGISTER_PATH, OAUTH_TOKEN_PATH } from "@/constants";

vi.mock("server-only", () => ({}));

const { resolveIssuanceThrottlePlan } = await import("@/lib/oauth/edge/issuance-throttle");

const CLIENT_IP = "203.0.113.10";

function formRequest(path: string, body: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

function resolve({ pathname, body = "" }: { pathname: string; body?: string }) {
  return resolveIssuanceThrottlePlan({
    pathname,
    request: formRequest(pathname, body),
    clientIp: CLIENT_IP,
  });
}

describe("OAuth issuance throttle policy", () => {
  test("charges a registration against the DCR bucket by IP", async () => {
    const plan = await resolve({ pathname: OAUTH_REGISTER_PATH });

    expect(plan).toEqual({
      endpoint: "dcr",
      policies: [{ rateLimit: "OAUTH_DCR", userIdentifier: CLIENT_IP }],
    });
  });

  test("leaves every other path unthrottled", async () => {
    for (const pathname of ["/", "/api/v1/me", "/oauth/authorize", "/.well-known/jwks.json"]) {
      expect(await resolve({ pathname })).toBeNull();
    }
  });

  // Prototype keys can never be a pathname (those always start with "/"), but the lookup must not
  // be the thing standing between us and that assumption.
  test("does not resolve a plan from an inherited object property", async () => {
    for (const pathname of ["constructor", "__proto__", "toString"]) {
      expect(await resolve({ pathname })).toBeNull();
    }
  });

  describe("token endpoint", () => {
    test("charges the IP bucket and the identity bucket for a code exchange", async () => {
      const plan = await resolve({
        pathname: OAUTH_TOKEN_PATH,
        body: "grant_type=authorization_code&code=user1%3Agrant1%3Asecret",
      });

      expect(plan?.endpoint).toBe("token");
      expect(plan?.policies).toEqual([
        { rateLimit: "OAUTH_TOKEN_IP", userIdentifier: CLIENT_IP },
        { rateLimit: "OAUTH_TOKEN_IDENTITY", userIdentifier: expect.any(String) },
      ]);
    });

    // The digest is the whole point of inspecting the form: no raw credential may reach a key.
    test("keys the identity bucket by a digest, never by the credential itself", async () => {
      const secret = "user1:grant1:super-secret-value";
      const plan = await resolve({
        pathname: OAUTH_TOKEN_PATH,
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(secret)}`,
      });

      const identity = plan?.policies.at(-1)?.userIdentifier ?? "";
      expect(identity).toMatch(/^[0-9a-f]{64}$/);
      expect(identity).not.toContain("super-secret-value");
    });

    // Rotated refresh tokens and the original code share one abuse bucket: the secret is dropped
    // before hashing, so the user/grant pair is what identifies the caller.
    test("gives a rotated refresh token the same identity as its authorization code", async () => {
      const [code, rotated] = await Promise.all([
        resolve({
          pathname: OAUTH_TOKEN_PATH,
          body: "grant_type=authorization_code&code=user1%3Agrant1%3Afirst",
        }),
        resolve({
          pathname: OAUTH_TOKEN_PATH,
          body: "grant_type=refresh_token&refresh_token=user1%3Agrant1%3Asecond",
        }),
      ]);

      expect(code?.policies.at(-1)?.userIdentifier)
        .toBe(rotated?.policies.at(-1)?.userIdentifier);
    });

    test("falls back to the IP bucket alone when no identity can be derived", async () => {
      const plan = await resolve({ pathname: OAUTH_TOKEN_PATH, body: "grant_type=client_credentials" });

      expect(plan?.policies).toEqual([{ rateLimit: "OAUTH_TOKEN_IP", userIdentifier: CLIENT_IP }]);
    });

    // RFC 7009 revocation must stay available even while issuance is being throttled.
    test("exempts a revocation request entirely", async () => {
      const plan = await resolve({ pathname: OAUTH_TOKEN_PATH, body: "token=some-token" });

      expect(plan).toBeNull();
    });

    // Classification is a soft control: if it throws, auth must keep working unthrottled.
    test("preserves the request when form classification fails", async () => {
      const request = new Request(`http://localhost${OAUTH_TOKEN_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=authorization_code",
      });
      vi.spyOn(request, "clone").mockImplementation(() => {
        throw new Error("body unavailable");
      });

      expect(await resolveIssuanceThrottlePlan({
        pathname: OAUTH_TOKEN_PATH,
        request,
        clientIp: CLIENT_IP,
      })).toBeNull();
    });
  });
});
