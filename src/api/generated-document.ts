import "server-only";

import documentJson from "virtual:api-openapi-document";
import type { OpenAPIV3_1 } from "openapi-types";

import { JSON_CONTENT_TYPE } from "@/constants";
import { STATIC_API_DOCUMENT_EDGE_CACHE_CONTROL } from "@/constants/cache-control";

// The one generated document, shared by the public `GET /api/v1/openapi.json` route, the MCP tool
// derivation, and the server-rendered docs UI.
//
// It is built by `scripts/generate-openapi.mjs` during the build (see `tools/openapi-document.ts`),
// never at runtime: generating it runs the whole Valibot -> JSON Schema conversion, which no
// isolate should pay for. Everything it describes is a static schema or a build-time constant, so
// the build-time document is exactly what a runtime one would have been.

/** The document as served: answering with these bytes costs no serialization. */
const apiDocumentJson: string = documentJson;

/**
 * The one response for the document, so the Worker's edge fast path and the Hono route below it
 * cannot drift apart on status or headers.
 */
export function apiDocumentResponse(): Response {
  return new Response(apiDocumentJson, {
    headers: {
      "cdn-cache-control": STATIC_API_DOCUMENT_EDGE_CACHE_CONTROL,
      "content-type": JSON_CONTENT_TYPE,
    },
  });
}

let parsed: OpenAPIV3_1.Document | null = null;

/**
 * Parsed form, for the readers that walk the document. Lazy and memoized per isolate: an API
 * request that never reads the document must not pay to materialize 60+ KiB of objects.
 */
export function apiDocument(): OpenAPIV3_1.Document {
  parsed ??= JSON.parse(apiDocumentJson) as OpenAPIV3_1.Document;

  return parsed;
}
