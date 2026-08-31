import type { AuthRequest, ClientInfo } from "@cloudflare/workers-oauth-provider";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  parseAuthRequest: vi.fn(),
  lookupClient: vi.fn(),
  getOAuthAppByClientId: vi.fn(),
  upsertOAuthApp: vi.fn(),
  correctLegacyCimdOAuthAppSources: vi.fn(),
}));

vi.mock("@/lib/oauth/provider-api", () => ({
  getOAuthHelpers: () => ({
    parseAuthRequest: mocks.parseAuthRequest,
    lookupClient: mocks.lookupClient,
  }),
}));

// Only the store is mocked. Client-id classification lives in `client-identity`, which has no
// runtime dependencies, so the real predicate runs here rather than a copy of it.
vi.mock("@/lib/oauth/oauth-apps", () => ({
  correctLegacyCimdOAuthAppSources: mocks.correctLegacyCimdOAuthAppSources,
  getOAuthAppByClientId: mocks.getOAuthAppByClientId,
  upsertOAuthApp: mocks.upsertOAuthApp,
}));

const { ensureOAuthAppRecord, persistApprovedOAuthApp, resolveConsentRequest } = await import(
  "@/lib/oauth/consent"
);

const REDIRECT_URI = "https://client.example/callback";

function buildAuthRequest(clientId: string): AuthRequest {
  return {
    responseType: "code",
    clientId,
    redirectUri: REDIRECT_URI,
    scope: ["profile:read"],
    state: "opaque-state",
    codeChallenge: "challenge",
    codeChallengeMethod: "S256",
  };
}

function buildClientInfo(clientId: string): ClientInfo {
  return {
    clientId,
    clientName: "Agent Client",
    logoUri: "https://client.example/logo.png",
    redirectUris: [REDIRECT_URI],
    tokenEndpointAuthMethod: "none",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOAuthAppByClientId.mockResolvedValue(null);
});

function stubClient(clientId: string) {
  mocks.parseAuthRequest.mockResolvedValue(buildAuthRequest(clientId));
  mocks.lookupClient.mockResolvedValue(buildClientInfo(clientId));
}

// Resolving is a query. It runs on every consent render *and* on both the approve and deny paths,
// so a write here would mirror clients nobody ever approved — and would do it on a denial.
describe("resolving a consent request", () => {
  test.each(["https://client.example/oauth-client.json", "dcr-client-id"])(
    "does not write anything while rendering %s",
    async (clientId) => {
      stubClient(clientId);

      await resolveConsentRequest({ authQuery: "client_id=ignored-by-mock" });

      expect(mocks.upsertOAuthApp).not.toHaveBeenCalled();
      expect(mocks.correctLegacyCimdOAuthAppSources).not.toHaveBeenCalled();
    },
  );

  test("reports the CIMD host for a URL-shaped client id and none for a DCR one", async () => {
    stubClient("https://client.example/oauth-client.json");
    expect((await resolveConsentRequest({ authQuery: "q" })).cimdHost).toBe("client.example");

    stubClient("dcr-client-id");
    expect((await resolveConsentRequest({ authQuery: "q" })).cimdHost).toBeNull();
  });

  // Consent has to say when the code lands on the user's own machine, because then the app that
  // opened the page is the app that receives it — no domain vouches for it.
  test("flags a loopback callback and leaves a hosted one unflagged", async () => {
    stubClient("dcr-client-id");
    expect((await resolveConsentRequest({ authQuery: "q" })).isLoopbackRedirect).toBe(false);

    mocks.parseAuthRequest.mockResolvedValue({
      ...buildAuthRequest("dcr-client-id"),
      redirectUri: "http://127.0.0.1:8976/callback",
    });
    const consent = await resolveConsentRequest({ authQuery: "q" });
    expect(consent.isLoopbackRedirect).toBe(true);
    expect(consent.redirectHost).toBe("127.0.0.1:8976");
  });
});

// The inline verify offer is one field, so the screen cannot show a prompt that would grant
// nothing. It stands only when verification is the single thing left between the request and its
// internal scopes.
describe("offering inline verification", () => {
  function stubAdminRequest({ isVerified }: { isVerified: boolean }) {
    const clientId = "dcr-client-id";
    mocks.parseAuthRequest.mockResolvedValue({
      ...buildAuthRequest(clientId),
      scope: ["profile:read", "admin:read"],
    });
    mocks.lookupClient.mockResolvedValue(buildClientInfo(clientId));
    mocks.getOAuthAppByClientId.mockResolvedValue(isVerified ? { verifiedAt: new Date() } : null);
  }

  test("names the scopes for an admin looking at an unverified client", async () => {
    stubAdminRequest({ isVerified: false });

    const consent = await resolveConsentRequest({ authQuery: "q", isAdmin: true });

    expect(consent.adminScopesToVerify).toEqual(["admin:read"]);
    expect(consent.grantedScopes).not.toContain("admin:read");
  });

  test("offers nothing to a non-admin, whatever the client asked for", async () => {
    stubAdminRequest({ isVerified: false });

    expect((await resolveConsentRequest({ authQuery: "q" })).adminScopesToVerify).toBeNull();
  });

  test("offers nothing once the client is verified, because the scopes are already granted", async () => {
    stubAdminRequest({ isVerified: true });

    const consent = await resolveConsentRequest({ authQuery: "q", isAdmin: true });

    expect(consent.adminScopesToVerify).toBeNull();
    expect(consent.grantedScopes).toContain("admin:read");
  });
});

// Verification is not an approval: it may create the row it needs to mark, but it must never
// refresh `updatedAt` on a row that already exists, because that timestamp records an approval.
describe("ensuring an OAuth app record before verification", () => {
  test("creates the row when the client has none", async () => {
    stubClient("https://client.example/oauth-client.json");

    await ensureOAuthAppRecord(await resolveConsentRequest({ authQuery: "q", isAdmin: true }));

    expect(mocks.upsertOAuthApp).toHaveBeenCalledTimes(1);
  });

  test("leaves an existing row untouched", async () => {
    stubClient("dcr-client-id");
    mocks.getOAuthAppByClientId.mockResolvedValue({ verifiedAt: null });

    await ensureOAuthAppRecord(await resolveConsentRequest({ authQuery: "q", isAdmin: true }));

    expect(mocks.upsertOAuthApp).not.toHaveBeenCalled();
  });
});

describe("persisting an approved OAuth app", () => {
  test("persists the CIMD identity and corrects a legacy source", async () => {
    const clientId = "https://client.example/oauth-client.json";
    stubClient(clientId);
    const consent = await resolveConsentRequest({ authQuery: "client_id=ignored-by-mock" });

    await persistApprovedOAuthApp(consent);

    expect(mocks.correctLegacyCimdOAuthAppSources).toHaveBeenCalledWith([clientId]);
    expect(mocks.upsertOAuthApp).toHaveBeenCalledWith({
      clientId,
      name: "Agent Client",
      logoUri: "https://client.example/logo.png",
      redirectUris: [REDIRECT_URI],
      tokenEndpointAuthMethod: "none",
      registrationSource: "cimd",
    });
  });

  // The response-boundary mirror is the primary path for DCR; approval is the backstop for a
  // registration whose interception was missed.
  test("mirrors a DCR client on approval without touching the legacy correction", async () => {
    const clientId = "dcr-client-id";
    stubClient(clientId);

    await persistApprovedOAuthApp(await resolveConsentRequest({ authQuery: "client_id=ignored-by-mock" }));

    expect(mocks.correctLegacyCimdOAuthAppSources).not.toHaveBeenCalled();
    expect(mocks.upsertOAuthApp).toHaveBeenCalledWith(expect.objectContaining({
      clientId,
      registrationSource: "dcr",
    }));
  });
});
