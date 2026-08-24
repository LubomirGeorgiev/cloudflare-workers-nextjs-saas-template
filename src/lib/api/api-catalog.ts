import "server-only";

import {
  API_CATALOG_CONTENT_TYPE,
  API_DOCS_PATH,
  API_OPENAPI_SPEC_PATH,
  API_V1_BASE_PATH,
  API_VERSION,
  HTML_CONTENT_TYPE,
  JSON_CONTENT_TYPE,
  MARKDOWN_CONTENT_TYPE,
  MCP_DOCS_PATH,
  MCP_PATH,
  OAUTH_PROTECTED_RESOURCE_PATH,
  SITE_NAME,
  SITE_URL,
} from "@/constants";
import { STATIC_API_DOCUMENT_EDGE_CACHE_CONTROL } from "@/constants/cache-control";
import { buildAbsoluteMarkdownPageUrl } from "@/lib/markdown-pages/page-paths";

// The RFC 9727 API catalog: one linkset (RFC 9264) naming every API this deployment publishes and
// where each one is described, served from `/.well-known/api-catalog` by the edge fast path in
// `worker-entrypoint.ts`. It depends on build-time constants alone, so it is serialized once per
// isolate rather than rebuilt per request.
//
// Titles are deliberately untranslated: this is a machine response, and the document is
// serialized synchronously at module scope, where the async `getTranslator` cannot be awaited.

/** An RFC 9264 link target object: the target URI plus the attributes we publish for it. */
export interface LinksetTarget {
  href: string;
  title: string;
  type: string;
}

/** One API. `anchor` is the API's own URI; each other key is a relation from that anchor. */
export interface LinksetContext {
  anchor: string;
  /** Machine-readable description of the API (RFC 8631). Optional: MCP publishes none. */
  "service-desc"?: readonly LinksetTarget[];
  /** Documentation a person reads (RFC 8631). */
  "service-doc": readonly LinksetTarget[];
  /** Metadata about the API that is neither description nor documentation (RFC 8631). */
  "service-meta": readonly LinksetTarget[];
}

// Both representations of one guide, HTML first. A `.md` twin is the same documentation without a
// page to parse, which is what an agent reading this catalog wants. Every path here is a fixed
// docs route the Worker always serves a twin for, so the URL is derived, not looked up.
function serviceDoc({ pathname, title }: { pathname: string; title: string }): LinksetTarget[] {
  return [
    { href: `${SITE_URL}${pathname}`, title, type: HTML_CONTENT_TYPE },
    {
      href: buildAbsoluteMarkdownPageUrl({ pathname }),
      title: `${title} (Markdown)`,
      type: MARKDOWN_CONTENT_TYPE,
    },
  ];
}

// RFC 9728 §3.1 inserts the well-known segment between the authority and the resource path, so a
// resource's metadata URL is its own path appended to the prefix — the same URL the API's 401
// `WWW-Authenticate` challenge points a client at.
function protectedResourceMetadata(resourcePath: string): LinksetTarget {
  return {
    href: `${SITE_URL}${OAUTH_PROTECTED_RESOURCE_PATH}${resourcePath}`,
    title: "OAuth protected resource metadata",
    type: JSON_CONTENT_TYPE,
  };
}

const apiCatalog: { linkset: readonly LinksetContext[] } = {
  linkset: [
    {
      anchor: `${SITE_URL}${API_V1_BASE_PATH}`,
      "service-desc": [
        {
          href: `${SITE_URL}${API_OPENAPI_SPEC_PATH}`,
          title: `${SITE_NAME} REST API ${API_VERSION} (OpenAPI 3.1)`,
          type: JSON_CONTENT_TYPE,
        },
      ],
      "service-doc": serviceDoc({ pathname: API_DOCS_PATH, title: "API reference" }),
      "service-meta": [protectedResourceMetadata(API_V1_BASE_PATH)],
    },
    {
      // No `service-desc`: an MCP client reads the tool list from the protocol itself, and the
      // OpenAPI document describes the REST paths, not this endpoint.
      anchor: `${SITE_URL}${MCP_PATH}`,
      "service-doc": serviceDoc({ pathname: MCP_DOCS_PATH, title: "MCP guide" }),
      "service-meta": [protectedResourceMetadata(MCP_PATH)],
    },
  ],
};

/** Prebuilt bytes, like the OpenAPI document: answering costs no serialization. */
const apiCatalogJson = JSON.stringify(apiCatalog);

export function apiCatalogResponse(): Response {
  return new Response(apiCatalogJson, {
    headers: {
      "cdn-cache-control": STATIC_API_DOCUMENT_EDGE_CACHE_CONTROL,
      "content-type": API_CATALOG_CONTENT_TYPE,
    },
  });
}
