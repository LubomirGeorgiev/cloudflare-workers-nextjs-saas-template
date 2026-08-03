// Static half of the OpenAPI contract. Every expectation derives from the template's own
// constants and scope catalog so a fork that rebrands SITE_NAME/SITE_URL or extends API_SCOPES
// keeps these tests passing.

import { describe, expect, test } from "vitest";

import {
  API_SECURITY_SCHEME_BEARER,
  API_SECURITY_SCHEME_OAUTH2,
  buildApiInfo,
  buildApiSecuritySchemes,
  buildApiServers,
  buildApiTags,
  securityForScope,
} from "@/api/openapi-document";
import {
  API_V1_BASE_PATH,
  API_VERSION,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_TOKEN_PATH,
  SITE_NAME,
  SITE_URL,
} from "@/constants";
import { API_SCOPE_NAMES, API_SCOPES } from "@/lib/api/scopes";

describe("openapi document metadata", () => {
  test("info and servers are derived from the site constants", () => {
    const info = buildApiInfo();

    expect(info.title).toContain(SITE_NAME);
    expect(info.version).toBe(API_VERSION);
    expect(buildApiServers()).toEqual([{ url: SITE_URL, description: SITE_NAME }]);
  });

  // The path keys already carry the base path, so a server URL that repeated it would make a
  // conformant client resolve `/api/v1/api/v1/...`.
  test("the server url carries no path component", () => {
    const url = new URL(buildApiServers()[0].url);

    expect(url.pathname).toBe("/");
    expect(buildApiServers()[0].url).not.toContain(API_V1_BASE_PATH);
  });

  test("the oauth flow advertises the endpoints the provider will serve", () => {
    const schemes = buildApiSecuritySchemes();
    const oauth = schemes[API_SECURITY_SCHEME_OAUTH2];

    expect(schemes[API_SECURITY_SCHEME_BEARER]).toMatchObject({ type: "http", scheme: "bearer" });
    expect(oauth).toMatchObject({ type: "oauth2" });
    expect(oauth.type === "oauth2" ? oauth.flows.authorizationCode : undefined).toMatchObject({
      authorizationUrl: `${SITE_URL}${OAUTH_AUTHORIZE_PATH}`,
      tokenUrl: `${SITE_URL}${OAUTH_TOKEN_PATH}`,
    });
  });

  // Phase 4 filters MCP tools by the scopes declared here, so a scope the catalog knows about
  // but the document omits would silently become unreachable.
  test("the oauth scope catalog is the full API_SCOPES catalog", () => {
    const schemes = buildApiSecuritySchemes();
    const oauth = schemes[API_SECURITY_SCHEME_OAUTH2];
    const scopes = oauth.type === "oauth2" ? oauth.flows.authorizationCode?.scopes : undefined;

    expect(Object.keys(scopes ?? {})).toEqual(API_SCOPE_NAMES);

    for (const scope of API_SCOPE_NAMES) {
      expect(scopes?.[scope]).toBe(API_SCOPES[scope].description);
    }
  });

  test("every operation accepts either credential type for its scope", () => {
    for (const scope of API_SCOPE_NAMES) {
      expect(securityForScope(scope)).toEqual([
        { [API_SECURITY_SCHEME_BEARER]: [scope] },
        { [API_SECURITY_SCHEME_OAUTH2]: [scope] },
      ]);
    }
  });

  test("tags are unique", () => {
    const names = buildApiTags().map((tag) => tag.name);

    expect(new Set(names).size).toBe(names.length);
  });
});
