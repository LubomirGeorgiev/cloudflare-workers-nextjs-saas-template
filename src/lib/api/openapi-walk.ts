import type { OpenAPIV3_1 } from "openapi-types";

// Neutral primitives for walking a generated OpenAPI 3.1 document. Both readers — the MCP tool
// derivation and the docs view model — build on this, so neither depends on the other to enumerate
// operations. Deliberately free of `server-only`, of policy, and of any runtime import.

/** Methods a documented operation can use, in the order the docs UI lists them. */
export const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

export const JSON_CONTENT_TYPE = "application/json";

interface DocumentOperation {
  /** OpenAPI path template including the API base path, e.g. `/api/v1/teams/{teamId}`. */
  path: string;
  method: HttpMethod;
  operation: OpenAPIV3_1.OperationObject;
}

export function isReference(value: unknown): value is OpenAPIV3_1.ReferenceObject {
  return typeof value === "object" && value !== null && "$ref" in value;
}

/** Anything inline enough to read as a schema: an object that is not a `$ref`. */
export function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !isReference(value);
}

/** Same narrowing as `isSchemaObject`, for callers that want the value or null. */
export function asSchemaObject(value: unknown): Record<string, unknown> | null {
  return isSchemaObject(value) ? value : null;
}

// The document declares one catalog scope per operation for both security schemes, so reading the
// first requirement is enough to know what the credential must hold.
export function scopeOfOperation(operation: OpenAPIV3_1.OperationObject): string | null {
  const requirement = operation.security?.[0];
  if (!requirement) {
    return null;
  }

  return Object.values(requirement)[0]?.[0] ?? null;
}

/** Fragment the docs reference page addresses an operation by, e.g. `operation-listTeams`. */
export function operationAnchorId(operationId: string): string {
  return `operation-${operationId}`;
}

/** Every documented operation, in document order. */
export function* walkOperations(
  document: Pick<OpenAPIV3_1.Document, "paths">,
): Generator<DocumentOperation> {
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = item?.[method];

      if (operation) {
        yield { path, method, operation };
      }
    }
  }
}
