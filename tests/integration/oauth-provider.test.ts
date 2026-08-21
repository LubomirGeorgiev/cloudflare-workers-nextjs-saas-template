/// <reference types="@cloudflare/vitest-plugin/types" />

// The OAuth authorization server end to end against real D1 + KV. `@cloudflare/workers-oauth-provider`
// is a plain library, so the whole dance — dynamic registration, consent, code exchange, refresh
// rotation, revocation — runs in-process here with nothing mocked but the Next app handler.
//
// The consent step is driven through our own server-side logic (`resolveConsentRequest` +
// `completeAuthorization`) rather than the rendered page: that is the code the anti-phishing scope
// clamp lives in, and it is what the approve action calls.
//
// Assertions derive from the app's own constants and scope catalog so a fork that rebrands paths
// or edits the catalog keeps them valid.

import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";

import {
  API_V1_BASE_PATH,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_CLIENT_REGISTRATION_TTL_SECONDS,
  OAUTH_CLIENT_RENEWAL_INTERVAL_SECONDS,
  OAUTH_CLIENT_RENEWAL_PAGE_SIZE,
  OAUTH_MAINTENANCE_INTERVAL_MINUTES,
  OAUTH_OPEN_DCR_ENABLED,
  OAUTH_REGISTER_PATH,
  OAUTH_TOKEN_PATH,
  OAUTH_PURGE_BATCH_SIZE,
  OAUTH_UNVERIFIED_CIMD_RETENTION_SECONDS,
} from "@/constants";
import { getDB } from "@/db";
import { apiKeyTable, oauthAppTable, userTable } from "@/db/schema";
import { API_SCOPE_NAMES, DCR_ALLOWED_SCOPES } from "@/lib/api/scopes";
import { persistApprovedOAuthApp, resolveConsentRequest } from "@/lib/oauth/consent";
import {
  pruneExpiredUnverifiedCimdOAuthApps,
  purgeExpiredOAuthData,
  renewVerifiedOAuthClients,
} from "@/lib/oauth/oauth-maintenance";
import { getDiscoveredOAuthAppRegistrationSource } from "@/lib/oauth/client-identity";
import {
  correctLegacyCimdOAuthAppSources,
  getOAuthAppByClientId,
  getOAuthAppsByClientIds,
  listOAuthAppsDueForRenewal,
  setOAuthAppVerified,
} from "@/lib/oauth/oauth-apps";
import { getOAuthHelpers } from "@/lib/oauth/provider-api";
import { generateApiKey } from "@/utils/api-key-format";

// A client record must survive several consecutive failed sweeps, not just one; the renewal
// interval is only meaningful while it divides the registration TTL at least this many times.
const MIN_RENEWALS_PER_REGISTRATION_LIFETIME = 12;

// The renewal page size and the maintenance interval are one knob in two halves: retuning either
// alone changes capacity. This is the verified-client population one renewal interval must cover.
const MIN_RENEWALS_PER_RENEWAL_INTERVAL = 10_000;

const innerFetchMock = vi.hoisted(() => vi.fn());

vi.mock("vinext/server/fetch-handler", () => ({
  default: { fetch: innerFetchMock },
}));

const { default: worker } = await import("../../worker-entrypoint");

const ORIGIN = "https://example.com";
const REDIRECT_URI = "https://client.example.org/callback";
const db = getDB();

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

beforeEach(() => {
  innerFetchMock.mockReset();
  innerFetchMock.mockImplementation(async () => new Response("next-app"));
});

async function seedUser(): Promise<{ id: string; email: string }> {
  const id = uid("usr");
  const email = `${id}@example.com`;

  await db.insert(userTable).values({
    id,
    email,
    firstName: "Oauth",
    lastName: "Caller",
    emailVerified: new Date(),
  });

  return { id, email };
}

function callWorker(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), env as Env, createExecutionContext());
}

async function registerClient(name = "Test Agent"): Promise<{ clientId: string }> {
  const response = await callWorker(OAUTH_REGISTER_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });

  expect(response.status).toBe(201);
  const body = await response.json() as { client_id: string };

  // The entrypoint mirrors registrations through `waitUntil`; do the same write inline so the
  // assertions below do not race the background task.
  const { mirrorDcrRegistration } = await import("@/lib/oauth/oauth-registration-mirror");
  await mirrorDcrRegistration(body);

  return { clientId: body.client_id };
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

function buildAuthQuery({
  clientId,
  challenge,
  scopes,
}: {
  clientId: string;
  challenge: string;
  scopes: string[];
}): string {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: scopes.join(" "),
    state: "opaque-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
}

// Everything the approve button does, minus the rendering: re-parse, re-clamp, complete.
async function approveConsent({
  authQuery,
  userId,
}: {
  authQuery: string;
  userId: string;
}): Promise<{ code: string; grantedScopes: string[] }> {
  const consent = await resolveConsentRequest(authQuery);
  await persistApprovedOAuthApp(consent);
  const { redirectTo } = await getOAuthHelpers().completeAuthorization({
    request: consent.authRequest,
    userId,
    scope: consent.grantedScopes,
    props: { credentialKind: "oauth-grant", userId, clientId: consent.authRequest.clientId },
    metadata: { createdAt: Date.now(), clientNameAtConsent: consent.clientName },
  });

  const code = new URL(redirectTo).searchParams.get("code");
  expect(code).toBeTruthy();

  return { code: code!, grantedScopes: consent.grantedScopes };
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

async function exchangeCode({
  clientId,
  code,
  verifier,
}: {
  clientId: string;
  code: string;
  verifier: string;
}): Promise<TokenResponse> {
  const response = await callWorker(OAUTH_TOKEN_PATH, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });

  expect(response.status).toBe(200);

  return await response.json() as TokenResponse;
}

// A full connect: register, consent, exchange. Returns everything the later steps need.
async function connectAgent({ scopes }: { scopes: string[] }) {
  const [user, { clientId }, pkce] = await Promise.all([
    seedUser(),
    registerClient(),
    createPkcePair(),
  ]);

  const authQuery = buildAuthQuery({ clientId, challenge: pkce.challenge, scopes });
  const { code, grantedScopes } = await approveConsent({ authQuery, userId: user.id });
  const tokens = await exchangeCode({ clientId, code, verifier: pkce.verifier });

  return { user, clientId, tokens, grantedScopes };
}

test.skipIf(!OAUTH_OPEN_DCR_ENABLED)(
  "dynamic client registration mirrors the client into D1 as unverified",
  async () => {
    const { clientId } = await registerClient("Mirrored Agent");
    const app = await getOAuthAppByClientId(clientId);

    expect(app).not.toBeNull();
    expect(app?.registrationSource).toBe("dcr");
    // Self-asserted registrations are never trusted on arrival — that is the whole scope tier.
    expect(app?.verifiedAt).toBeNull();
    expect(app?.redirectUris).toEqual([REDIRECT_URI]);
  },
);

test.skipIf(!OAUTH_OPEN_DCR_ENABLED)(
  "matching DCR metadata never merges clients or inherits verification",
  async () => {
    const first = await registerClient("Repeated Agent");
    await setOAuthAppVerified({ clientId: first.clientId, isVerified: true });

    // A second installation is a distinct OAuth identity even when every self-asserted field is
    // identical. Reusing the verified row here would let a copycat inherit trust.
    const second = await registerClient("Repeated Agent");
    expect(second.clientId).not.toBe(first.clientId);

    const [firstApp, secondApp] = await Promise.all([
      getOAuthAppByClientId(first.clientId),
      getOAuthAppByClientId(second.clientId),
    ]);
    expect(firstApp?.verifiedAt).toBeInstanceOf(Date);
    expect(secondApp).toMatchObject({
      name: "Repeated Agent",
      redirectUris: [REDIRECT_URI],
      registrationSource: "dcr",
      verifiedAt: null,
    });
  },
);

test("CIMD URLs are stable identities and legacy mirrors are corrected without losing trust", async () => {
  expect(getDiscoveredOAuthAppRegistrationSource("https://agent.example/oauth-client.json"))
    .toBe("cimd");
  expect(getDiscoveredOAuthAppRegistrationSource("generated-client-id"))
    .toBe("dcr");

  const clientId = `https://agent.example/${uid("legacy-cimd")}.json`;
  const verifiedAt = new Date();
  await db.insert(oauthAppTable).values({
    clientId,
    registrationSource: "dcr",
    verifiedAt,
  });

  await correctLegacyCimdOAuthAppSources([clientId]);
  const corrected = await getOAuthAppByClientId(clientId);
  expect(corrected?.registrationSource).toBe("cimd");
  expect(Math.floor(corrected!.verifiedAt!.getTime() / 1_000))
    .toBe(Math.floor(verifiedAt.getTime() / 1_000));
});

test.skipIf(OAUTH_OPEN_DCR_ENABLED)("registration is rejected when the DCR flag is off", async () => {
  const response = await callWorker(OAUTH_REGISTER_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
  });

  // With no registration endpoint configured the path is not the provider's, so it falls through
  // to the Next app rather than issuing a client.
  expect(response.status).not.toBe(201);
});

test.skipIf(!OAUTH_OPEN_DCR_ENABLED)(
  "a registered agent reaches the API with the token it was issued",
  async () => {
    const { user, tokens, grantedScopes } = await connectAgent({ scopes: ["profile:read"] });

    expect(tokens.scope.split(" ")).toEqual(grantedScopes);
    expect(tokens.expires_in).toBeLessThanOrEqual(OAUTH_ACCESS_TOKEN_TTL_SECONDS);
    expect(tokens.refresh_token).toBeTruthy();

    const response = await callWorker(`${API_V1_BASE_PATH}/me`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { id: string; email: string };
    expect(body.id).toBe(user.id);
    expect(body.email).toBe(user.email);
    // The API is never served by the Next app, whichever credential got it there.
    expect(innerFetchMock).not.toHaveBeenCalled();
  },
);

test.skipIf(!OAUTH_OPEN_DCR_ENABLED)(
  "an unverified client cannot be granted a restricted scope, and verifying it can",
  async () => {
    const restricted = API_SCOPE_NAMES.filter((scope) => !DCR_ALLOWED_SCOPES.includes(scope));
    expect(restricted.length).toBeGreaterThan(0);

    const [user, { clientId }, pkce] = await Promise.all([
      seedUser(),
      registerClient(),
      createPkcePair(),
    ]);
    const requested = ["profile:read", ...restricted];
    const authQuery = buildAuthQuery({ clientId, challenge: pkce.challenge, scopes: requested });

    const clamped = await resolveConsentRequest(authQuery);
    expect(clamped.isVerified).toBe(false);
    expect(clamped.grantedScopes).not.toContain(restricted[0]);
    expect(clamped.droppedScopes).toEqual(restricted);

    // The token must carry the clamp, not just the screen.
    const { code } = await approveConsent({ authQuery, userId: user.id });
    const tokens = await exchangeCode({ clientId, code, verifier: pkce.verifier });
    expect(tokens.scope.split(" ")).not.toContain(restricted[0]);

    await setOAuthAppVerified({ clientId, isVerified: true });
    const verified = await resolveConsentRequest(authQuery);
    expect(verified.isVerified).toBe(true);
    expect(verified.grantedScopes).toEqual(requested);
    expect(verified.droppedScopes).toEqual([]);
  },
);

test.skipIf(!OAUTH_OPEN_DCR_ENABLED)("refreshing rotates the refresh token", async () => {
  const { clientId, tokens } = await connectAgent({ scopes: ["profile:read"] });

  const response = await callWorker(OAUTH_TOKEN_PATH, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token!,
      client_id: clientId,
    }),
  });

  expect(response.status).toBe(200);
  const refreshed = await response.json() as TokenResponse;

  expect(refreshed.access_token).not.toBe(tokens.access_token);
  expect(refreshed.refresh_token).toBeTruthy();
  expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);
  expect(refreshed.scope).toBe(tokens.scope);

  const apiResponse = await callWorker(`${API_V1_BASE_PATH}/me`, {
    headers: { authorization: `Bearer ${refreshed.access_token}` },
  });
  expect(apiResponse.status).toBe(200);
});

test.skipIf(!OAUTH_OPEN_DCR_ENABLED)("revoking a grant kills its access token", async () => {
  const { user, tokens } = await connectAgent({ scopes: ["profile:read"] });
  const helpers = getOAuthHelpers();

  const before = await helpers.listUserGrants(user.id);
  expect(before.items).toHaveLength(1);
  expect(before.items[0].metadata).toMatchObject({ clientNameAtConsent: "Test Agent" });

  await helpers.revokeGrant(before.items[0].id, user.id);

  const response = await callWorker(`${API_V1_BASE_PATH}/me`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });

  expect(response.status).toBe(401);
  expect(await helpers.listUserGrants(user.id)).toMatchObject({ items: [] });
});

test.skipIf(!OAUTH_OPEN_DCR_ENABLED)(
  "the renewal sweep re-puts verified client records and skips unverified ones",
  async () => {
    const [verified, unverified] = await Promise.all([
      registerClient("Verified Agent"),
      registerClient("Unverified Agent"),
    ]);
    await setOAuthAppVerified({ clientId: verified.clientId, isVerified: true });

    const result = await renewVerifiedOAuthClients();
    expect(result).toMatchObject({ missing: 0, failed: 0 });
    expect(result.renewed).toBeGreaterThanOrEqual(1);

    const [verifiedRow, unverifiedRow] = await Promise.all([
      getOAuthAppByClientId(verified.clientId),
      getOAuthAppByClientId(unverified.clientId),
    ]);

    expect(verifiedRow?.lastRenewedAt).toBeInstanceOf(Date);
    // Unverified registrations are deliberately left to expire on normal DCR garbage collection.
    expect(unverifiedRow?.lastRenewedAt).toBeNull();

    // The touch keeps the record the provider actually reads alive, not just the D1 row.
    expect(await getOAuthHelpers().lookupClient(verified.clientId)).not.toBeNull();
  },
);

test("only verified DCR leases enter the renewal queue", async () => {
  await db.update(oauthAppTable).set({ lastRenewedAt: new Date() });

  const clientIds = {
    dcr: uid("renew-dcr"),
    cimd: `https://agent.example/${uid("renew-cimd")}.json`,
    portal: uid("renew-portal"),
  };
  await db.insert(oauthAppTable).values([
    { clientId: clientIds.dcr, registrationSource: "dcr", verifiedAt: new Date() },
    { clientId: clientIds.cimd, registrationSource: "cimd", verifiedAt: new Date() },
    { clientId: clientIds.portal, registrationSource: "portal", verifiedAt: new Date() },
  ]);

  const due = await listOAuthAppsDueForRenewal({
    limit: OAUTH_CLIENT_RENEWAL_PAGE_SIZE,
    dueBefore: new Date(),
  });

  expect(due.map((app) => app.clientId)).toContain(clientIds.dcr);
  expect(due.map((app) => app.clientId)).not.toContain(clientIds.cimd);
  expect(due.map((app) => app.clientId)).not.toContain(clientIds.portal);
});

test.skipIf(!OAUTH_OPEN_DCR_ENABLED)(
  "mirror pruning survives a provider sweep that can never complete, and preserves stable or verified apps",
  async () => {
    const now = new Date();
    const expiredAt = new Date(
      now.getTime() - OAUTH_CLIENT_REGISTRATION_TTL_SECONDS * 1000 - 1_000,
    );
    const [expired, verified, live] = await Promise.all([
      registerClient("Expired DCR"),
      registerClient("Verified DCR"),
      registerClient("Live DCR"),
    ]);
    await setOAuthAppVerified({ clientId: verified.clientId, isVerified: true });

    const stableClientIds = {
      cimd: `https://agent.example/${uid("prune-cimd")}.json`,
      portal: uid("prune-portal"),
    };
    await db.insert(oauthAppTable).values([
      {
        clientId: stableClientIds.cimd,
        // Legacy consent mirrors classified URL-shaped CIMD clients as DCR. Cleanup must correct
        // this deterministically even when the metadata document cannot currently be fetched.
        registrationSource: "dcr",
        createdAt: expiredAt,
      },
      {
        clientId: stableClientIds.portal,
        registrationSource: "portal",
        createdAt: expiredAt,
      },
    ]);
    await db
      .update(oauthAppTable)
      .set({ createdAt: expiredAt })
      .where(eq(oauthAppTable.clientId, expired.clientId));
    await db
      .update(oauthAppTable)
      .set({ createdAt: expiredAt })
      .where(eq(oauthAppTable.clientId, verified.clientId));

    // Simulate KV TTL expiry without deleteClient(), which would hide the exact safety condition
    // this test exercises by cascading grants itself.
    await Promise.all([
      env.OAUTH_KV.delete(`client:${expired.clientId}`),
      env.OAUTH_KV.delete(`client:${verified.clientId}`),
    ]);

    // The shape that stalls the library sweep forever: a whole budget of healthy grants that sorts
    // first. The library keeps its list cursor in a local variable, so every call restarts here,
    // spends the budget on grants it must keep, and never reaches the key behind them.
    const liveGrantOwner = `000-${uid("live-owner")}`;
    const grantIdWidth = String(OAUTH_PURGE_BATCH_SIZE).length;
    await Promise.all(Array.from({ length: OAUTH_PURGE_BATCH_SIZE }, async (_, index) => {
      const grantId = `grant-${index.toString().padStart(grantIdWidth, "0")}`;
      await env.OAUTH_KV.put(
        `grant:${liveGrantOwner}:${grantId}`,
        JSON.stringify({
          id: grantId,
          userId: liveGrantOwner,
          clientId: live.clientId,
          scope: ["profile:read"],
          createdAt: Math.floor(now.getTime() / 1000),
        }),
      );
    }));

    const orphanGrantOwner = `001-${uid("orphan-owner")}`;
    const orphanGrantId = "grant-orphan";
    const orphanGrantKey = `grant:${orphanGrantOwner}:${orphanGrantId}`;
    await env.OAUTH_KV.put(
      orphanGrantKey,
      JSON.stringify({
        id: orphanGrantId,
        userId: orphanGrantOwner,
        clientId: expired.clientId,
        scope: ["profile:read"],
        createdAt: Math.floor(now.getTime() / 1000),
      }),
    );

    const firstSweep = await purgeExpiredOAuthData(now);

    // Pruning must not wait for `done`: each candidate is proven dead by its own client lookup.
    expect(firstSweep.providerSweepComplete).toBe(false);
    expect(await env.OAUTH_KV.get(orphanGrantKey)).not.toBeNull();
    expect(firstSweep.mirrorsPruned).toBeGreaterThanOrEqual(1);
    expect(await getOAuthAppByClientId(expired.clientId)).toBeNull();

    // The next tick restarts at the same key, so the stall never clears on its own.
    const secondSweep = await purgeExpiredOAuthData(now);
    expect(secondSweep.providerSweepComplete).toBe(false);

    expect(await getOAuthAppByClientId(verified.clientId)).not.toBeNull();
    expect(await getOAuthAppByClientId(stableClientIds.cimd)).toMatchObject({
      registrationSource: "cimd",
    });
    expect(await getOAuthAppByClientId(stableClientIds.portal)).not.toBeNull();
    // The live client keeps its grants: a stalled sweep must not become an excuse to delete data.
    expect(await env.OAUTH_KV.get(`grant:${liveGrantOwner}:grant-${"0".repeat(grantIdWidth)}`))
      .not.toBeNull();
  },
);

test.skipIf(OAUTH_UNVERIFIED_CIMD_RETENTION_SECONDS === undefined)(
  "old unverified CIMD mirrors are pruned without touching recently approved or verified apps",
  async () => {
    const retentionSeconds = OAUTH_UNVERIFIED_CIMD_RETENTION_SECONDS;
    if (retentionSeconds === undefined) {
      throw new Error("CIMD retention is disabled");
    }

    const now = new Date();
    const expiredAt = new Date(now.getTime() - retentionSeconds * 1000 - 2_000);
    const clientIds = {
      expired: `https://agent.example/${uid("expired-cimd")}.json`,
      recentlyApproved: `https://agent.example/${uid("active-cimd")}.json`,
      verified: `https://agent.example/${uid("verified-cimd")}.json`,
      dcr: uid("old-dcr"),
      portal: uid("old-portal"),
    };

    await db.insert(oauthAppTable).values([
      {
        clientId: clientIds.expired,
        registrationSource: "cimd",
        createdAt: expiredAt,
        updatedAt: expiredAt,
      },
      {
        clientId: clientIds.recentlyApproved,
        registrationSource: "cimd",
        createdAt: expiredAt,
        updatedAt: now,
      },
      {
        clientId: clientIds.verified,
        registrationSource: "cimd",
        verifiedAt: new Date(),
        createdAt: expiredAt,
        updatedAt: expiredAt,
      },
      {
        clientId: clientIds.dcr,
        registrationSource: "dcr",
        createdAt: expiredAt,
        updatedAt: expiredAt,
      },
      {
        clientId: clientIds.portal,
        registrationSource: "portal",
        createdAt: expiredAt,
        updatedAt: expiredAt,
      },
    ]);

    const result = await pruneExpiredUnverifiedCimdOAuthApps(now);

    expect(result.retentionEnabled).toBe(true);
    expect(result.mirrorsPruned).toBeGreaterThanOrEqual(1);
    expect(await getOAuthAppByClientId(clientIds.expired)).toBeNull();
    expect(await getOAuthAppByClientId(clientIds.recentlyApproved)).not.toBeNull();
    expect(await getOAuthAppByClientId(clientIds.verified)).not.toBeNull();
    expect(await getOAuthAppByClientId(clientIds.dcr)).not.toBeNull();
    expect(await getOAuthAppByClientId(clientIds.portal)).not.toBeNull();
  },
);

// D1 caps bound parameters per statement, and this row is wide enough that a 25-row insert blows
// it; small chunks keep the seed under the limit whatever the page size is.
const SEED_INSERT_CHUNK_SIZE = 5;

// Seeds verified D1 rows for clients the provider has never heard of: the permanently unrenewable
// case that used to sit at the head of `lastRenewedAt ASC` forever.
async function seedDeadVerifiedApps(count: number): Promise<string[]> {
  const clientIds = Array.from({ length: count }, () => uid("dead"));

  for (let i = 0; i < clientIds.length; i += SEED_INSERT_CHUNK_SIZE) {
    await db.insert(oauthAppTable).values(
      clientIds.slice(i, i + SEED_INSERT_CHUNK_SIZE).map((clientId) => ({
        clientId,
        name: "Vanished Agent",
        registrationSource: "dcr" as const,
        verifiedAt: new Date(),
      })),
    );
  }

  return clientIds;
}

test.skipIf(!OAUTH_OPEN_DCR_ENABLED)(
  "a full page of unrenewable clients cannot starve a healthy one out of the sweep",
  async () => {
    // Storage is shared across this file's tests; stamping what is already there makes the first
    // page below exactly the rows this test seeds.
    await db.update(oauthAppTable).set({ lastRenewedAt: new Date() });

    const [deadClientIds, healthy] = await Promise.all([
      seedDeadVerifiedApps(OAUTH_CLIENT_RENEWAL_PAGE_SIZE),
      registerClient("Healthy Agent"),
    ]);
    await setOAuthAppVerified({ clientId: healthy.clientId, isVerified: true });

    // Due, but behind every dead row: SQLite orders NULLs first, so the dead page is what the
    // first tick sees.
    const staleSeconds =
      Math.floor(Date.now() / 1000) - OAUTH_CLIENT_RENEWAL_INTERVAL_SECONDS * 2;
    // Whole seconds: the column has second resolution, so a millisecond part would not round-trip.
    const staleSince = new Date(staleSeconds * 1000);
    await db
      .update(oauthAppTable)
      .set({ lastRenewedAt: staleSince })
      .where(eq(oauthAppTable.clientId, healthy.clientId));

    const firstTick = await renewVerifiedOAuthClients();
    expect(firstTick).toMatchObject({ renewed: 0, missing: OAUTH_CLIENT_RENEWAL_PAGE_SIZE });

    // The page moved even though nothing could be renewed — this is what unblocks the queue. A
    // full page also proves the id lists behind these calls stay inside D1's bound-parameter cap.
    const deadRows = await getOAuthAppsByClientIds(deadClientIds);
    expect(deadRows.size).toBe(deadClientIds.length);
    for (const row of deadRows.values()) {
      expect(row.lastRenewedAt).toBeInstanceOf(Date);
    }

    // Still starved after one tick, renewed on the next: the progression the old code never made.
    const beforeSecondTick = await getOAuthAppByClientId(healthy.clientId);
    expect(beforeSecondTick?.lastRenewedAt).toEqual(staleSince);

    const secondTick = await renewVerifiedOAuthClients();
    expect(secondTick).toMatchObject({ renewed: 1, missing: 0, failed: 0 });

    const afterSecondTick = await getOAuthAppByClientId(healthy.clientId);
    expect(afterSecondTick?.lastRenewedAt?.getTime()).toBeGreaterThan(staleSince.getTime());
    // The point of the sweep: the record the provider actually reads is still there.
    expect(await getOAuthHelpers().lookupClient(healthy.clientId)).not.toBeNull();
  },
);

test.skipIf(!OAUTH_OPEN_DCR_ENABLED)(
  "the provider applies the client registration TTL this app configures",
  async () => {
    // Only confidential clients get a secret back, and its expiry is the registration TTL the
    // library applied to the KV record — the one observable the app can check.
    const response = await callWorker(OAUTH_REGISTER_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Confidential Agent",
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "client_secret_basic",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as {
      client_id_issued_at: number;
      client_secret_expires_at: number;
    };

    expect(body.client_secret_expires_at - body.client_id_issued_at)
      .toBe(OAUTH_CLIENT_REGISTRATION_TTL_SECONDS);
    // Renewal is only a safety net while it runs many times inside that lifetime.
    expect(OAUTH_CLIENT_RENEWAL_INTERVAL_SECONDS * MIN_RENEWALS_PER_REGISTRATION_LIFETIME)
      .toBeLessThanOrEqual(OAUTH_CLIENT_REGISTRATION_TTL_SECONDS);
  },
);

test("the renewal page size and the maintenance interval stay paced to each other", () => {
  const ticksPerDay = (24 * 60) / OAUTH_MAINTENANCE_INTERVAL_MINUTES;
  const renewalIntervalDays = OAUTH_CLIENT_RENEWAL_INTERVAL_SECONDS / (24 * 60 * 60);

  // Slowing the tick without growing the page cuts renewal capacity, and nothing else reports it.
  expect(OAUTH_CLIENT_RENEWAL_PAGE_SIZE * ticksPerDay * renewalIntervalDays)
    .toBeGreaterThanOrEqual(MIN_RENEWALS_PER_RENEWAL_INTERVAL);
});

test.skipIf(!OAUTH_OPEN_DCR_ENABLED)(
  "the consent screen refuses a redirect URI the client never registered",
  async () => {
    const { clientId } = await registerClient();
    const { challenge } = await createPkcePair();
    const authQuery = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: "https://attacker.example.net/steal",
      scope: "profile:read",
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();

    await expect(resolveConsentRequest(authQuery)).rejects.toThrow();
  },
);

// The Phase 3 regression that matters most: API keys used to be routed straight to the Hono app,
// and now enter through the provider's `resolveExternalToken` hook instead. Both credential types
// must arrive at the same handler with an equivalent principal.
test("an API key still authenticates through the provider's external-token hook", async () => {
  const user = await seedUser();
  const generated = await generateApiKey();

  await db.insert(apiKeyTable).values({
    id: uid("akey"),
    userId: user.id,
    name: "integration",
    keyHash: generated.hash,
    keyPrefix: generated.prefix,
    last4: generated.last4,
    scopes: ["profile:read"],
  });

  const response = await callWorker(`${API_V1_BASE_PATH}/me`, {
    headers: { authorization: `Bearer ${generated.secret}` },
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id: user.id, email: user.email });
  expect(innerFetchMock).not.toHaveBeenCalled();
});

test("a garbage bearer token is rejected with the discovery pointer", async () => {
  const response = await callWorker(`${API_V1_BASE_PATH}/me`, {
    headers: { authorization: "Bearer not-a-credential" },
  });

  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
});

test("the consent page is served by the Next app, not the provider", async () => {
  const response = await callWorker(`${OAUTH_AUTHORIZE_PATH}?client_id=whatever`);

  expect(innerFetchMock).toHaveBeenCalledOnce();
  expect(await response.text()).toBe("next-app");
});
