import "server-only"

import { decodeBase64urlIgnorePadding, encodeBase64urlNoPadding } from "@oslojs/encoding";

import { SITE_URL } from "@/constants";
import { createBase64UrlToken } from "@/utils/random-token";

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
// Google mints the issuer with and without the scheme; both are legitimate.
const GOOGLE_ID_TOKEN_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_SSO_SCOPES = ["openid", "profile", "email"];
// 32 bytes base64url-encodes to 43 chars, the RFC 7636 minimum for a code verifier.
const OAUTH_SECRET_BYTES = 32;
const ID_TOKEN_CLOCK_SKEW_SECONDS = 60;

export interface GoogleIdTokenClaims {
  // JWT issuer, usually https://accounts.google.com.
  iss: string
  // OAuth client id authorized for this token.
  azp?: string
  // Intended OAuth client id audience.
  aud: string
  // Stable Google user id.
  sub: string
  email: string
  email_verified: boolean
  // Access token hash from the ID token.
  at_hash?: string
  name?: string
  picture?: string
  given_name?: string
  family_name?: string
  iat: number
  exp: number
}

function getGoogleOAuthConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri: `${SITE_URL}/sso/google/callback`,
  };
}

export function generateState(): string {
  return createBase64UrlToken(OAUTH_SECRET_BYTES);
}

export function generateCodeVerifier(): string {
  return createBase64UrlToken(OAUTH_SECRET_BYTES);
}

async function createCodeChallenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));

  return encodeBase64urlNoPadding(new Uint8Array(digest));
}

export async function createGoogleAuthorizationURL({
  state,
  codeVerifier,
}: {
  state: string
  codeVerifier: string
}): Promise<URL> {
  const { clientId, redirectUri } = getGoogleOAuthConfig();

  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", GOOGLE_SSO_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await createCodeChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");

  return url;
}

export async function validateGoogleAuthorizationCode({
  code,
  codeVerifier,
}: {
  code: string
  codeVerifier: string
}): Promise<string> {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google token endpoint responded with ${response.status}: ${await response.text()}`);
  }

  const tokens = await response.json() as { id_token?: string };

  if (!tokens.id_token) {
    throw new Error("Google token response did not include an ID token");
  }

  return tokens.id_token;
}

function decodeIdTokenPayload(idToken: string): GoogleIdTokenClaims {
  const parts = idToken.split(".");

  if (parts.length !== 3) {
    throw new Error("Malformed Google ID token");
  }

  const payload = new TextDecoder().decode(decodeBase64urlIgnorePadding(parts[1]));
  const claims: unknown = JSON.parse(payload);

  if (typeof claims !== "object" || claims === null) {
    throw new Error("Google ID token payload is not an object");
  }

  return claims as GoogleIdTokenClaims;
}

function assertGoogleIdTokenIdentity(claims: GoogleIdTokenClaims): void {
  const { clientId } = getGoogleOAuthConfig();

  if (!GOOGLE_ID_TOKEN_ISSUERS.includes(claims.iss)) {
    throw new Error(`Unexpected Google ID token issuer: ${claims.iss}`);
  }

  if (claims.aud !== clientId) {
    throw new Error("Google ID token was issued for a different OAuth client");
  }

  if (claims.azp && claims.azp !== clientId) {
    throw new Error("Google ID token authorized party does not match the OAuth client");
  }

  if (typeof claims.sub !== "string" || !claims.sub) {
    throw new Error("Google ID token is missing a subject");
  }

  if (typeof claims.email !== "string" || !claims.email) {
    throw new Error("Google ID token is missing an email");
  }
}

function assertGoogleIdTokenFreshness(claims: GoogleIdTokenClaims): void {
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds - ID_TOKEN_CLOCK_SKEW_SECONDS) {
    throw new Error("Google ID token has expired");
  }

  if (typeof claims.iat !== "number" || claims.iat > nowSeconds + ID_TOKEN_CLOCK_SKEW_SECONDS) {
    throw new Error("Google ID token was issued in the future");
  }
}

export function parseGoogleIdToken(idToken: string): GoogleIdTokenClaims {
  const claims = decodeIdTokenPayload(idToken);

  // The signature is intentionally not verified: the token comes straight from Google's token
  // endpoint over TLS, which OIDC Core 3.1.3.7 accepts in place of validating the JWS.
  assertGoogleIdTokenIdentity(claims);
  assertGoogleIdTokenFreshness(claims);

  return claims;
}
