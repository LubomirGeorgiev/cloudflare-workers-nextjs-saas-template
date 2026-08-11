import "server-only";

import type { OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";

import {
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_CLIENT_REGISTRATION_TTL_SECONDS,
  OAUTH_OPEN_DCR_ENABLED,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
  OAUTH_REGISTER_PATH,
  OAUTH_TOKEN_PATH,
} from "@/constants";
import { API_SCOPE_NAMES } from "@/lib/api/scopes";
import type { OAuthBearerProps } from "@/lib/oauth/bearer-props";

// Handler-free half of the provider configuration. `worker-entrypoint.ts` adds the handlers and
// the external-token hook; `provider-api.ts` reuses this to build the same helpers outside a
// request. Both must agree — TTLs and PKCE policy are read back when grants are minted.
export const oauthCoreOptions = {
  authorizeEndpoint: OAUTH_AUTHORIZE_PATH,
  tokenEndpoint: OAUTH_TOKEN_PATH,
  // Omitted entirely when the template kill-switch is off: the library treats an absent
  // registration endpoint as "DCR not supported" and drops it from the discovery document.
  ...(OAUTH_OPEN_DCR_ENABLED ? { clientRegistrationEndpoint: OAUTH_REGISTER_PATH } : {}),
  // CIMD: a URL-shaped client_id is fetched as a metadata document, giving domain-bound identity
  // without any stored registration. Requires the global_fetch_strictly_public compat flag.
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: [...API_SCOPE_NAMES],
  // Advertised in RFC 9728 protected resource metadata, which is a *separate* list from
  // `scopesSupported` above. MCP clients that discover us through the bearer challenge read the
  // scope catalog from here; omit it and they send no `scope` at all and consent to nothing.
  resourceMetadata: { scopes_supported: [...API_SCOPE_NAMES] },
  allowPlainPKCE: false,
  accessTokenTTL: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenTTL: OAUTH_REFRESH_TOKEN_TTL_SECONDS,
  // Set explicitly, never left to the library's default: the cron renewal interval is calibrated
  // against this lifetime, so it has to be app-owned and reviewable in one place.
  clientRegistrationTTL: OAUTH_CLIENT_REGISTRATION_TTL_SECONDS,
  // Open registration still passes through the provider's RFC validation; this callback adds
  // app-owned resource bounds and URI policy immediately before the client is persisted. Imported
  // on first registration, never at startup: this module is on the cold path of every request.
  clientRegistrationCallback: async (options) =>
    (await import("@/lib/oauth/registration-policy")).validateDcrRegistration(options),
  // Consent-time props know nothing about the token they will ride on, and a client may downscope
  // at the token endpoint. Stamping the grant id and the *effective* scopes per access token is
  // what lets the API middleware authorize against what this token actually carries.
  // `requestedScope` is already the granted∩requested set; returning no `accessTokenScope`
  // leaves the library's own scoping untouched.
  tokenExchangeCallback: ({ grantId, requestedScope, props }) => ({
    accessTokenProps: {
      ...(props as OAuthBearerProps),
      grantId,
      scopes: requestedScope,
    } satisfies OAuthBearerProps,
  }),
} satisfies Omit<OAuthProviderOptions<Env>, "defaultHandler">;
