import "server-only";

import documentJson from "virtual:admin-openapi-document";
import type { OpenAPIV3_1 } from "openapi-types";

// The internal document, built at build time alongside the public one by
// `scripts/generate-openapi.mjs`. Read by exactly two callers: the internal MCP server's tool
// derivation, and the admin panel's reference page.
//
// There is deliberately no `Response` producer here, unlike `src/api/generated-document.ts`.
// Nothing serves these bytes over HTTP — not behind auth, not at the edge — so the only shape this
// module exposes is the parsed document a server-side reader walks.

let parsed: OpenAPIV3_1.Document | null = null;

/** Lazy and memoized per isolate: a request that never reads the document pays nothing for it. */
export function adminApiDocument(): OpenAPIV3_1.Document {
  parsed ??= JSON.parse(documentJson) as OpenAPIV3_1.Document;

  return parsed;
}
