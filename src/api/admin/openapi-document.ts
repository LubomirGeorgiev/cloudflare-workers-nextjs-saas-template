import type { OpenAPIV3_1 } from "openapi-types";

import { ADMIN_API_BASE_PATH, API_VERSION, SITE_NAME, SITE_URL } from "@/constants";
import type { AdminScope } from "@/lib/api/admin-scopes";

// Static half of the *internal* OpenAPI document, mirroring `src/api/openapi-document.ts` for the
// public one. Kept separate rather than parameterized: the two documents must not be able to grow
// a shared code path that could publish an admin path or an `admin:*` scope into the public bytes.
//
// The bearer scheme covers both credential kinds, which is why there is no separate `oauth2` entry:
// the public document's OAuth flow publishes `API_SCOPE_NAMES` as its scope map, and an internal
// scope is deliberately absent from that list. These endpoints advertise their own scopes through
// their RFC 9728 metadata instead — see `worker-entrypoint.ts`.

// File-local: both readers of the name are below, and it is not part of any public contract.
const ADMIN_SECURITY_SCHEME_BEARER = "adminApiKey";

export const ADMIN_API_TAGS = {
  users: "Users",
  oauthApps: "OAuth apps",
  cms: "CMS",
} as const;

export function securityForAdminScope(scope: AdminScope): OpenAPIV3_1.SecurityRequirementObject[] {
  return [{ [ADMIN_SECURITY_SCHEME_BEARER]: [scope] }];
}

export function buildAdminApiInfo(): OpenAPIV3_1.InfoObject {
  return {
    title: `${SITE_NAME} internal admin API`,
    version: API_VERSION,
    description:
      `Internal administrative API for ${SITE_NAME}. Not part of the public API contract: it is ` +
      "absent from the published OpenAPI document, the API catalog, and llms.txt. Authenticate " +
      "either with an API key minted in the admin panel, or with an OAuth access token — the " +
      "authorization server issues an `admin:*` scope only to a live admin consenting to a " +
      "verified client. Every request re-checks that the account behind the credential still holds " +
      "the admin role, so revoking that role revokes its power at once. Errors are RFC 9457 " +
      "problem documents whose `code` member is a stable, untranslated identifier.",
  };
}

// Origin only, like the public document: every path key already carries `ADMIN_API_BASE_PATH`.
export function buildAdminApiServers(): OpenAPIV3_1.ServerObject[] {
  return [{ url: SITE_URL, description: `${SITE_NAME} (${ADMIN_API_BASE_PATH})` }];
}

export function buildAdminSecuritySchemes(): Record<string, OpenAPIV3_1.SecuritySchemeObject> {
  return {
    [ADMIN_SECURITY_SCHEME_BEARER]: {
      type: "http",
      scheme: "bearer",
      description:
        "An API key created in the admin panel with an internal scope, or an OAuth access token " +
        "carrying one, sent as `Authorization: Bearer <credential>`. Account settings can grant " +
        "neither; an OAuth grant requires a live admin consenting to a verified client.",
    },
  };
}

export function buildAdminApiTags(): OpenAPIV3_1.TagObject[] {
  return Object.values(ADMIN_API_TAGS).map((name) => ({ name }));
}
