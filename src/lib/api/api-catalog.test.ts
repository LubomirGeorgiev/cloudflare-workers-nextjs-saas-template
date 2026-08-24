import { describe, expect, test, vi } from "vitest";

import {
  API_CATALOG_CONTENT_TYPE,
  API_DOCS_PATH,
  API_OPENAPI_SPEC_PATH,
  API_V1_BASE_PATH,
  HTML_CONTENT_TYPE,
  MARKDOWN_CONTENT_TYPE,
  MARKDOWN_EXTENSION,
  MCP_DOCS_PATH,
  MCP_PATH,
  OAUTH_PROTECTED_RESOURCE_PATH,
  SITE_URL,
} from "@/constants";
import { STATIC_API_DOCUMENT_EDGE_CACHE_CONTROL } from "@/constants/cache-control";
import type { LinksetContext, LinksetTarget } from "./api-catalog";

vi.mock("server-only", () => ({}));

const { apiCatalogResponse } = await import("./api-catalog");

async function readCatalog(): Promise<LinksetContext[]> {
  const body = await apiCatalogResponse().json() as { linkset: LinksetContext[] };

  return body.linkset;
}

function contextFor(linkset: LinksetContext[], anchor: string): LinksetContext {
  const context = linkset.find((entry) => entry.anchor === anchor);

  expect(context).toBeDefined();

  return context as LinksetContext;
}

describe("API catalog document", () => {
  test("is served as a linkset", () => {
    expect(apiCatalogResponse().headers.get("content-type")).toBe(API_CATALOG_CONTENT_TYPE);
  });

  // The edge fast path answers ahead of the metadata cache wrapper, so the producer is the only
  // place this policy can come from. The document changes on deploy alone, hence no cache tag.
  test("carries the deploy-only edge cache policy", () => {
    const headers = apiCatalogResponse().headers;

    expect(headers.get("cdn-cache-control")).toBe(STATIC_API_DOCUMENT_EDGE_CACHE_CONTROL);
    expect(headers.get("cache-tag")).toBeNull();
  });

  test("anchors one context per published API", async () => {
    const linkset = await readCatalog();

    expect(linkset.map((context) => context.anchor)).toEqual([
      `${SITE_URL}${API_V1_BASE_PATH}`,
      `${SITE_URL}${MCP_PATH}`,
    ]);
  });

  test("points the REST anchor at the OpenAPI document", async () => {
    const context = contextFor(await readCatalog(), `${SITE_URL}${API_V1_BASE_PATH}`);

    expect(context["service-desc"]?.[0]?.href).toBe(`${SITE_URL}${API_OPENAPI_SPEC_PATH}`);
  });

  // Both representations of one guide, so a client that cannot render HTML still reads the docs.
  test.each([
    ["REST", API_V1_BASE_PATH, API_DOCS_PATH],
    ["MCP", MCP_PATH, MCP_DOCS_PATH],
  ])("documents the %s anchor as HTML and as Markdown", async (__api, anchorPath, docsPath) => {
    const context = contextFor(await readCatalog(), `${SITE_URL}${anchorPath}`);

    expect(context["service-doc"].map(({ href, type }) => ({ href, type }))).toEqual([
      { href: `${SITE_URL}${docsPath}`, type: HTML_CONTENT_TYPE },
      { href: `${SITE_URL}${docsPath}${MARKDOWN_EXTENSION}`, type: MARKDOWN_CONTENT_TYPE },
    ]);
  });

  // RFC 9728 §3.1: the metadata URL of a resource is its own path under the well-known prefix,
  // which is also what the 401 challenge in `src/api/middleware/auth.ts` sends a client to.
  test("names the protected resource metadata URL of every anchor", async () => {
    const linkset = await readCatalog();

    expect(linkset.map((context) => context["service-meta"][0].href)).toEqual(
      [API_V1_BASE_PATH, MCP_PATH].map(
        (resourcePath) => `${SITE_URL}${OAUTH_PROTECTED_RESOURCE_PATH}${resourcePath}`,
      ),
    );
  });

  test("gives every target a title and a media type", async () => {
    const targets: LinksetTarget[] = (await readCatalog()).flatMap((context) => [
      ...context["service-desc"] ?? [],
      ...context["service-doc"],
      ...context["service-meta"],
    ]);

    expect(targets.filter(({ title, type }) => !title || !type)).toEqual([]);
  });
});
