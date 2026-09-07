import "server-only";

import documentJson from "virtual:admin-openapi-document";
import type { OpenAPIV3_1 } from "openapi-types";

import { JSON_CONTENT_TYPE } from "@/constants";
import { INTERNAL_API_DOCUMENT_CACHE_CONTROL } from "@/constants/cache-control";

// The internal document, built at build time alongside the public one by
// `scripts/generate-openapi.mjs`. Read by the internal MCP server's tool derivation and, through
// `adminApiDocumentResponse` below, by `ADMIN_API_OPENAPI_PATH`.
//
// Unlike the public twin, these bytes describe the whole internal surface: only an admin cookie
// session or admin bearer credential gets them (`src/api/admin/openapi-endpoint.ts`), and
// `no-store` keeps every cache out of that decision.

/** The one response for the document, so no caller can drift on status, headers, or caching.
 * Answering with the built bytes costs no serialization. */
export function adminApiDocumentResponse(): Response {
  return new Response(documentJson, {
    headers: {
      "cache-control": INTERNAL_API_DOCUMENT_CACHE_CONTROL,
      "content-type": JSON_CONTENT_TYPE,
    },
  });
}

let parsed: OpenAPIV3_1.Document | null = null;

/** Lazy and memoized per isolate: a request that never reads the document pays nothing for it. */
export function adminApiDocument(): OpenAPIV3_1.Document {
  parsed ??= JSON.parse(documentJson) as OpenAPIV3_1.Document;

  return parsed;
}
