import { v } from "@/lib/validation";
import { FIELD_ERROR_CODES, FIELD_ERROR_LOCATIONS } from "@/lib/api/field-errors";

// Response shapes for the public REST API. They document the contract in the OpenAPI document,
// and every handler types its mapper as `v.InferOutput<typeof schema>` — nothing here validates at
// runtime, but a payload that drifts from its documented shape is a compile error.

export const problemSchema = v.object({
  type: v.string(),
  title: v.string(),
  status: v.number(),
  // Stable, untranslated machine code (NOT_AUTHORIZED, FORBIDDEN, RATE_LIMITED, ...).
  code: v.string(),
  detail: v.string(),
  requestId: v.optional(v.string()),
  retryAfter: v.optional(v.number()),
  // Present on validation 400s: one entry per rejected value. Both vocabularies are published as
  // enums from their own catalogs, so an agent reads them off the document instead of guessing.
  errors: v.optional(
    v.array(
      v.object({
        // Which part of the request the value came from, in OpenAPI's parameter vocabulary.
        in: v.picklist(FIELD_ERROR_LOCATIONS),
        // RFC 6901 JSON Pointer to the rejected value; "" addresses the whole payload.
        pointer: v.string(),
        code: v.picklist(FIELD_ERROR_CODES),
        // The violated constraint, when the code carries one: {"min":2}.
        params: v.optional(v.record(v.string(), v.union([v.string(), v.number()]))),
      }),
    ),
  ),
});

export const successSchema = v.object({
  success: v.literal(true),
});

export { teamIdParamSchema } from "@/schemas/fields";

// Every timestamp the API emits is an ISO 8601 string; `null` means "never" / "not yet".
export const isoDateSchema = v.pipe(v.string(), v.isoTimestamp());
export const nullableIsoDateSchema = v.nullable(isoDateSchema);

// A query value reaches a route as a string from Hono's query map and as a number from an MCP tool
// argument, so a numeric query field must take both. Anything else becomes NaN and `v.number()`
// refuses it as a wrong type.
function toQueryNumber(value: unknown): number {
  return typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
}

/**
 * The one integer query field. Every numeric query parameter must use it: a plain `v.number()`
 * rejects the string the query map actually carries, so an explicitly passed value answers 400.
 *
 * The `v.unknown()` base is what keeps the generated contract honest — a `v.union([string, number])`
 * base would publish `anyOf: [string, number]` as the parameter type in the OpenAPI document and in
 * the MCP tool input schema, while this emits the plain `integer` a caller should send.
 */
export function integerQueryField({
  min,
  max,
  fallback,
}: {
  min: number;
  max?: number;
  fallback: number;
}) {
  const bounded = v.pipe(
    v.unknown(),
    v.transform(toQueryNumber),
    v.number(),
    v.integer(),
    v.minValue(min),
  );

  return v.optional(max === undefined ? bounded : v.pipe(bounded, v.maxValue(max)), fallback);
}

/**
 * The boolean twin of `integerQueryField`, for the same reason: the query map carries `"true"`,
 * while an MCP tool argument carries a real boolean, and `v.boolean()` alone refuses one of them.
 * The `v.unknown()` base keeps the published parameter type a plain `boolean`.
 */
export function booleanQueryField() {
  return v.pipe(
    v.unknown(),
    v.transform((value) => (typeof value === "string" ? value === "true" : Boolean(value))),
    v.boolean(),
  );
}
