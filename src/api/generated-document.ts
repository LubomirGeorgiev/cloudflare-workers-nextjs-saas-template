import "server-only";

import documentJson from "virtual:api-openapi-document";
import type { OpenAPIV3_1 } from "openapi-types";

// The one generated document, shared by the public `GET /api/v1/openapi.json` route, the MCP tool
// derivation, and the server-rendered docs UI.
//
// It is built by `scripts/generate-openapi.mjs` during the build (see `tools/openapi-document.ts`),
// never at runtime: generating it runs the whole Valibot -> JSON Schema conversion, which no
// isolate should pay for. Everything it describes is a static schema or a build-time constant, so
// the build-time document is exactly what a runtime one would have been.

/** The document as served: answering with these bytes costs no serialization. */
export const apiDocumentJson: string = documentJson;

let parsed: OpenAPIV3_1.Document | null = null;

/**
 * Parsed form, for the readers that walk the document. Lazy and memoized per isolate: an API
 * request that never reads the document must not pay to materialize 60+ KiB of objects.
 */
export function apiDocument(): OpenAPIV3_1.Document {
  parsed ??= JSON.parse(apiDocumentJson) as OpenAPIV3_1.Document;

  return parsed;
}
