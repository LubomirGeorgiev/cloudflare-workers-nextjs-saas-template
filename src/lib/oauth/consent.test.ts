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

const { persistApprovedOAuthApp, resolveConsentRequest } = await import("@/lib/oauth/consent");

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

      await resolveConsentRequest("client_id=ignored-by-mock");

      expect(mocks.upsertOAuthApp).not.toHaveBeenCalled();
      expect(mocks.correctLegacyCimdOAuthAppSources).not.toHaveBeenCalled();
    },
  );

  test("reports the CIMD host for a URL-shaped client id and none for a DCR one", async () => {
    stubClient("https://client.example/oauth-client.json");
    expect((await resolveConsentRequest("q")).cimdHost).toBe("client.example");

    stubClient("dcr-client-id");
    expect((await resolveConsentRequest("q")).cimdHost).toBeNull();
  });
});

describe("persisting an approved OAuth app", () => {
  test("persists the CIMD identity and corrects a legacy source", async () => {
    const clientId = "https://client.example/oauth-client.json";
    stubClient(clientId);
    const consent = await resolveConsentRequest("client_id=ignored-by-mock");

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

    await persistApprovedOAuthApp(await resolveConsentRequest("client_id=ignored-by-mock"));

    expect(mocks.correctLegacyCimdOAuthAppSources).not.toHaveBeenCalled();
    expect(mocks.upsertOAuthApp).toHaveBeenCalledWith(expect.objectContaining({
      clientId,
      registrationSource: "dcr",
    }));
  });
});
