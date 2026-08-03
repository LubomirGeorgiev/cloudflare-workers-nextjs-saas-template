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
