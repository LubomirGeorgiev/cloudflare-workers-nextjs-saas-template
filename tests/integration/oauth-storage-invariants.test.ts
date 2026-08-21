/// <reference types="@cloudflare/vitest-plugin/types" />

import { AuthorizationError } from "@cloudflare/workers-oauth-provider";
import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { afterEach, expect, test, vi } from "vitest";

import {
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_CLIENT_REGISTRATION_TTL_SECONDS,
  OAUTH_OPEN_DCR_ENABLED,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
  OAUTH_REGISTER_PATH,
  OAUTH_TOKEN_PATH,
} from "@/constants";
import { getOAuthHelpers } from "@/lib/oauth/provider-api";
import { oauthCoreOptions } from "@/lib/oauth/provider-config";

const innerFetchMock = vi.hoisted(() => vi.fn());

vi.mock("vinext/server/fetch-handler", () => ({
  default: { fetch: innerFetchMock },
}));

const { default: worker } = await import("../../worker-entrypoint");

const ORIGIN = "https://example.com";
const REDIRECT_URI = "https://client.example.org/callback";
const AUTHORIZATION_CODE_TTL_SECONDS = 10 * 60;
const EXPIRATION_TOLERANCE_SECONDS = 10;

let sequence = 0;

function uniqueId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
}

function callWorker(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}${path}`, init),
    env as Env,
    createExecutionContext(),
  );
}

function base64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));

  return { verifier, challenge: base64Url(digest) };
}

async function getOnlyKeyExpiration(prefix: string): Promise<number> {
  const result = await env.OAUTH_KV.list({ prefix });
  const keys = result.keys.filter((key) => key.name.startsWith(prefix));

  expect(keys).toHaveLength(1);
  expect(keys[0]?.expiration).toBeTypeOf("number");

  return keys[0]!.expiration!;
}

function expectExpirationNear({
  expiration,
  issuedAfter,
  ttl,
}: {
  expiration: number;
  issuedAfter: number;
  ttl: number;
}): void {
  expect(expiration).toBeGreaterThanOrEqual(issuedAfter + ttl - EXPIRATION_TOLERANCE_SECONDS);
  expect(expiration).toBeLessThanOrEqual(Math.floor(Date.now() / 1_000) + ttl);
}

afterEach(() => {
  vi.unstubAllGlobals();
  innerFetchMock.mockReset();
});

test("discovery and configuration keep OAuth storage on finite lifetimes", async () => {
  const configuredTtls = [
    oauthCoreOptions.accessTokenTTL,
    oauthCoreOptions.refreshTokenTTL,
    oauthCoreOptions.clientRegistrationTTL,
  ];

  expect(configuredTtls).toEqual([
    OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    OAUTH_REFRESH_TOKEN_TTL_SECONDS,
    OAUTH_CLIENT_REGISTRATION_TTL_SECONDS,
  ]);
  for (const ttl of configuredTtls) {
    expect(Number.isSafeInteger(ttl)).toBe(true);
    expect(ttl).toBeGreaterThan(0);
  }

  const response = await callWorker("/.well-known/oauth-authorization-server");
  const metadata = await response.json() as {
    client_id_metadata_document_supported: boolean;
    grant_types_supported: string[];
    response_modes_supported: string[];
    response_types_supported: string[];
  };

  expect(response.status).toBe(200);
  expect(metadata.client_id_metadata_document_supported).toBe(true);
  expect(metadata.response_types_supported).toEqual(["code"]);
  expect(metadata.response_modes_supported).toEqual(["query"]);
  expect(metadata.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);

  // A resolvable client is a precondition: client_id and the registered redirect URI are validated
  // before response_type, so CIMD stands one up without leaving a client KV record behind.
  const clientId = `https://client.example.org/${uniqueId("implicit")}.json`;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    client_id: clientId,
    client_name: "Implicit Flow Probe",
    redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: "none",
  })));

  const implicitRequest = getOAuthHelpers().parseAuthRequest(
    new Request(
      `${ORIGIN}${OAUTH_AUTHORIZE_PATH}?response_type=token&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
    ),
  );

  // Assert the RFC error code, not the prose: `description` is wire copy the library rewords.
  await expect(implicitRequest).rejects.toBeInstanceOf(AuthorizationError);
  await expect(implicitRequest).rejects.toMatchObject({ code: "unsupported_response_type" });
});

test("a CIMD lookup fetches metadata without creating a client KV record", async () => {
  const clientId = `https://client.example.org/${uniqueId("cimd")}.json`;
  const clientKey = `client:${clientId}`;
  const fetchMock = vi.fn(async () => Response.json({
    client_id: clientId,
    client_name: "CIMD Agent",
    redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: "none",
  }));
  vi.stubGlobal("fetch", fetchMock);

  expect(await env.OAUTH_KV.get(clientKey)).toBeNull();

  const client = await getOAuthHelpers().lookupClient(clientId);

  expect(client).toMatchObject({
    clientId,
    clientName: "CIMD Agent",
    redirectUris: [REDIRECT_URI],
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(await env.OAUTH_KV.get(clientKey)).toBeNull();
  expect((await env.OAUTH_KV.list({ prefix: clientKey })).keys).toHaveLength(0);
});

test.skipIf(!OAUTH_OPEN_DCR_ENABLED)(
  "authorization-code storage changes from a temporary grant to expiring grant and token records",
  async () => {
    if (OAUTH_REFRESH_TOKEN_TTL_SECONDS === undefined) {
      throw new Error("OAuth refresh tokens must have a finite TTL");
    }

    const registeredAfter = Math.floor(Date.now() / 1_000);
    const registrationResponse = await callWorker(OAUTH_REGISTER_PATH, {
      method: "POST",
      headers: {
        "cf-connecting-ip": "192.0.2.51",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        client_name: "TTL Invariant Agent",
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    expect(registrationResponse.status).toBe(201);
    const { client_id: clientId } = await registrationResponse.json() as { client_id: string };

    expectExpirationNear({
      expiration: await getOnlyKeyExpiration(`client:${clientId}`),
      issuedAfter: registeredAfter,
      ttl: OAUTH_CLIENT_REGISTRATION_TTL_SECONDS,
    });

    const userId = uniqueId("ttl-user");
    const { verifier, challenge } = await createPkcePair();
    const authorizedAfter = Math.floor(Date.now() / 1_000);
    const { redirectTo } = await getOAuthHelpers().completeAuthorization({
      request: {
        responseType: "code",
        clientId,
        redirectUri: REDIRECT_URI,
        scope: ["profile:read"],
        state: "storage-invariant",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
      },
      userId,
      scope: ["profile:read"],
      props: { credentialKind: "oauth-grant", userId, clientId },
      metadata: { createdAt: Date.now() },
    });
    const code = new URL(redirectTo).searchParams.get("code");
    expect(code).toBeTruthy();
    const grantId = code!.split(":")[1];
    expect(grantId).toBeTruthy();
    const grantKey = `grant:${userId}:${grantId}`;

    expectExpirationNear({
      expiration: await getOnlyKeyExpiration(grantKey),
      issuedAfter: authorizedAfter,
      ttl: AUTHORIZATION_CODE_TTL_SECONDS,
    });

    const exchangedAfter = Math.floor(Date.now() / 1_000);
    const tokenResponse = await callWorker(OAUTH_TOKEN_PATH, {
      method: "POST",
      headers: {
        "cf-connecting-ip": "192.0.2.52",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier,
      }),
    });
    expect(tokenResponse.status).toBe(200);
    const tokens = await tokenResponse.json() as {
      access_token: string;
      expires_in: number;
      refresh_token: string;
    };
    expect(tokens.expires_in).toBe(OAUTH_ACCESS_TOKEN_TTL_SECONDS);
    expect(tokens.refresh_token).toBeTruthy();

    expectExpirationNear({
      expiration: await getOnlyKeyExpiration(grantKey),
      issuedAfter: exchangedAfter,
      ttl: OAUTH_REFRESH_TOKEN_TTL_SECONDS,
    });
    expectExpirationNear({
      expiration: await getOnlyKeyExpiration(`token:${userId}:${grantId}:`),
      issuedAfter: exchangedAfter,
      ttl: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    });
  },
);
