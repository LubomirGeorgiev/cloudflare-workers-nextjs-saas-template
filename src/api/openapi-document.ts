import type { OpenAPIV3_1 } from "openapi-types";

import {
  API_VERSION,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_TOKEN_PATH,
  SITE_NAME,
  SITE_URL,
} from "@/constants";
import { API_SCOPES, type ApiScope } from "@/lib/api/scopes";

// Static half of the OpenAPI document: everything not derived from the route table. Kept free of
// server-only imports so the contract can be asserted in a plain unit test.

export const API_SECURITY_SCHEME_BEARER = "apiKey";
export const API_SECURITY_SCHEME_OAUTH2 = "oauth2";

export const API_TAGS = {
  account: "Account",
  teams: "Teams",
  members: "Members",
  invitations: "Invitations",
  billing: "Billing",
  apiKeys: "API keys",
} as const;

function scopeCatalog(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(API_SCOPES).map(([scope, definition]) => [scope, definition.description]),
  );
}

// Declared per operation so the document states exactly which scope each operation needs. Phase 4
// derives MCP tools from this metadata to filter `tools/list` by the caller's granted scopes.
export function securityForScope(scope: ApiScope): OpenAPIV3_1.SecurityRequirementObject[] {
  return [
    { [API_SECURITY_SCHEME_BEARER]: [scope] },
    { [API_SECURITY_SCHEME_OAUTH2]: [scope] },
  ];
}

export function buildApiInfo(): OpenAPIV3_1.InfoObject {
  return {
    title: `${SITE_NAME} API`,
    version: API_VERSION,
    description:
      `Public REST API for ${SITE_NAME}. Authenticate with a bearer API key or an OAuth 2.1 access token. ` +
      "Scopes narrow what a credential may do; team permissions are still enforced per request. " +
      "Errors are RFC 9457 problem documents whose `code` member is a stable, untranslated identifier. " +
      "Every response carries `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` " +
      "(seconds until the window resets) for the bucket the request was charged against.",
  };
}

// Origin only: the Hono app is mounted at `API_V1_BASE_PATH`, so every path key already carries
// the prefix. Repeating it here would make a conformant client resolve `/api/v1/api/v1/...`.
export function buildApiServers(): OpenAPIV3_1.ServerObject[] {
  return [{ url: SITE_URL, description: SITE_NAME }];
}

export function buildApiSecuritySchemes(): Record<string, OpenAPIV3_1.SecuritySchemeObject> {
  return {
    [API_SECURITY_SCHEME_BEARER]: {
      type: "http",
      scheme: "bearer",
      description: "An API key created from account or team settings, sent as `Authorization: Bearer <key>`.",
    },
    [API_SECURITY_SCHEME_OAUTH2]: {
      type: "oauth2",
      description: "OAuth 2.1 authorization code flow with PKCE, for third-party apps and agent clients.",
      flows: {
        authorizationCode: {
          authorizationUrl: `${SITE_URL}${OAUTH_AUTHORIZE_PATH}`,
          tokenUrl: `${SITE_URL}${OAUTH_TOKEN_PATH}`,
          scopes: scopeCatalog(),
        },
      },
    },
  };
}

export function buildApiTags(): OpenAPIV3_1.TagObject[] {
  return Object.values(API_TAGS).map((name) => ({ name }));
}
