import "server-only";

import type { AuthRequest, ClientInfo } from "@cloudflare/workers-oauth-provider";

import { OAUTH_AUTHORIZE_PATH, SITE_URL } from "@/constants";
import { clampScopesForClient, type ApiScope } from "@/lib/api/scopes";
import {
  getDiscoveredOAuthAppRegistrationSource,
  isCimdClientId,
  isLoopbackHost,
} from "@/lib/oauth/client-identity";
import {
  correctLegacyCimdOAuthAppSources,
  getOAuthAppByClientId,
  upsertOAuthApp,
} from "@/lib/oauth/oauth-apps";
import { getOAuthHelpers } from "@/lib/oauth/provider-api";

interface ConsentRequest {
  authRequest: AuthRequest;
  clientInfo: ClientInfo;
  clientName: string | null;
  logoUri: string | null;
  isVerified: boolean;
  /** Scopes that will actually be granted — already clamped for unverified clients. */
  grantedScopes: ApiScope[];
  /** Requested scopes the clamp (or an unknown name) removed; shown so consent stays honest. */
  droppedScopes: string[];
  /** Host of the callback the code would be delivered to — the strongest anti-phishing signal. */
  redirectHost: string | null;
  /** Set when the client identifies itself by a Client ID Metadata Document URL (domain-bound). */
  cimdHost: string | null;
  /** The id itself, shown for a DCR client because it has no domain to show instead. */
  clientId: string;
  /** The code lands on this device, so the app that opened the page is the one that receives it. */
  isLoopbackRedirect: boolean;
}

function urlOf(value: string | undefined): URL | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function hostOf(value: string | undefined): string | null {
  return urlOf(value)?.host ?? null;
}

// `parseAuthRequest` only reads the query string, so rebuilding the URL against SITE_URL is
// equivalent to handing it the original request — and keeps the page free of header plumbing.
function toAuthorizeRequest(authQuery: string): Request {
  return new Request(`${SITE_URL}${OAUTH_AUTHORIZE_PATH}?${authQuery}`);
}

// Resolves everything the consent screen and the approve action both need. Called twice per
// approval on purpose: the action never trusts the browser's copy of the scopes, it re-derives
// them (including the unverified-client clamp) from the re-validated authorization request.
export async function resolveConsentRequest(authQuery: string): Promise<ConsentRequest> {
  const helpers = getOAuthHelpers();
  // Throws for an unknown client or a redirect URI the client did not register.
  const authRequest = await helpers.parseAuthRequest(toAuthorizeRequest(authQuery));

  const [clientInfo, app] = await Promise.all([
    helpers.lookupClient(authRequest.clientId),
    getOAuthAppByClientId(authRequest.clientId),
  ]);

  if (!clientInfo) {
    throw new Error("Unknown OAuth client");
  }

  const redirectUrl = urlOf(authRequest.redirectUri);
  const isVerified = Boolean(app?.verifiedAt);
  const grantedScopes = clampScopesForClient({
    requestedScopes: authRequest.scope,
    isVerified,
  });

  return {
    authRequest,
    clientInfo,
    clientName: app?.name ?? clientInfo.clientName ?? null,
    logoUri: app?.logoUri ?? clientInfo.logoUri ?? null,
    isVerified,
    grantedScopes,
    droppedScopes: authRequest.scope.filter(
      (scope) => !grantedScopes.includes(scope as ApiScope),
    ),
    redirectHost: hostOf(authRequest.redirectUri),
    cimdHost: isCimdClientId(authRequest.clientId) ? hostOf(authRequest.clientId) : null,
    clientId: authRequest.clientId,
    isLoopbackRedirect: isLoopbackHost(redirectUrl?.hostname ?? ""),
  };
}

// The only write on the consent path: resolving a request stays a pure query, so rendering the
// screen or denying it never mirrors a client. CIMD has no provider-side client record, so its D1
// identity is created only once an authenticated user approves. Re-approval refreshes updatedAt,
// which is the retention proof that a fixed-lifetime grant may still exist. For DCR this doubles as
// the backstop for a registration whose response-boundary mirror was missed.
export async function persistApprovedOAuthApp(consent: ConsentRequest): Promise<void> {
  const registrationSource = getDiscoveredOAuthAppRegistrationSource(
    consent.authRequest.clientId,
  );

  if (registrationSource === "cimd") {
    await correctLegacyCimdOAuthAppSources([consent.authRequest.clientId]);
  }

  await upsertOAuthApp({
    clientId: consent.authRequest.clientId,
    name: consent.clientInfo.clientName,
    logoUri: consent.clientInfo.logoUri,
    redirectUris: consent.clientInfo.redirectUris,
    tokenEndpointAuthMethod: consent.clientInfo.tokenEndpointAuthMethod,
    registrationSource,
  });
}

// Denial is an OAuth-protocol answer, not an error page: the client is redirected back with
// `access_denied` so it can stop waiting instead of hanging on an abandoned browser tab.
export function buildDenialRedirect(authRequest: AuthRequest): string | null {
  if (!authRequest.redirectUri) {
    return null;
  }

  const url = new URL(authRequest.redirectUri);
  url.searchParams.set("error", "access_denied");
  url.searchParams.set("error_description", "The user denied the authorization request.");
  if (authRequest.state) {
    url.searchParams.set("state", authRequest.state);
  }

  return url.toString();
}
