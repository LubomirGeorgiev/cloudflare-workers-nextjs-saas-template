// One rejected value in an RFC 9457 problem document, derived from the *shape* of the failure and
// never from an i18n catalog key: message copy has to stay free to change, and a public contract
// does not. `in` + `pointer` locate the value; `code` + `params` say what was wrong with it.

/**
 * The whole published vocabulary. A code here is public contract — renaming one breaks every
 * client branching on it, the same discipline `operationId`s and scope names are held to.
 */
export const FIELD_ERROR_CODES = [
  "required",
  "invalid_type",
  "invalid_value",
  "invalid_format",
  "min_length",
  "max_length",
  "min_value",
  "max_value",
] as const;

type FieldErrorCode = (typeof FIELD_ERROR_CODES)[number];

/**
 * OpenAPI's own parameter-location vocabulary, so a client can line an error up with the
 * parameters the operation documents.
 */
export const FIELD_ERROR_LOCATIONS = ["body", "query", "path", "header", "cookie"] as const;

type FieldErrorLocation = (typeof FIELD_ERROR_LOCATIONS)[number];

/** Hono's validator targets onto that vocabulary. */
const LOCATION_BY_TARGET: Record<string, FieldErrorLocation> = {
  json: "body",
  form: "body",
  query: "query",
  param: "path",
  header: "header",
  cookie: "cookie",
};

// Valibot reports an absent object key on the *object* schema rather than the entry's, so the
// received value — not the issue type — is what tells a missing value from a wrong-typed one.
const UNDEFINED_RECEIVED = "undefined";

// Schema types that reject a value for not being one of the permitted ones rather than for being
// the wrong type. Everything else of `kind: "schema"` is a type mismatch.
const VALUE_SCHEMA_TYPES = new Set(["picklist", "literal", "enum", "union", "variant"]);

// Validation types that constrain a value's format; the type name doubles as the format name.
const FORMAT_VALIDATION_TYPES = new Set([
  "email",
  "hexadecimal",
  "ip",
  "iso_date",
  "iso_timestamp",
  "regex",
  "url",
  "uuid",
]);

// Bounded-size validations and the param name each one reports its requirement under.
const BOUND_PARAM_BY_VALIDATION_TYPE: Record<string, "min" | "max"> = {
  min_length: "min",
  max_length: "max",
  min_value: "min",
  max_value: "max",
};

// `integer` is a type refinement in Valibot but reads as a type to a caller, so it reports as one.
const INTEGER_VALIDATION_TYPE = "integer";

/**
 * Structurally what Standard Schema reports, restated locally so this module needs no direct
 * dependency on the spec package.
 */
export interface ValidationIssue {
  readonly kind?: string;
  readonly type?: string;
  readonly expected?: string | null;
  readonly received?: string;
  readonly requirement?: unknown;
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[];
}

/** One rejected field; every member is stable, untranslated machine contract. */
export interface ProblemFieldError {
  in: FieldErrorLocation;
  /** RFC 6901 JSON Pointer to the rejected value; `""` addresses the whole payload. */
  pointer: string;
  code: FieldErrorCode;
  /** The constraint that was violated, when the code carries one. */
  params?: Record<string, string | number>;
}

function segmentKey(segment: PropertyKey | { readonly key: PropertyKey }): PropertyKey {
  return typeof segment === "object" && segment !== null && "key" in segment ? segment.key : segment;
}

/** RFC 6901: `~` and `/` are the only characters a reference token has to escape. */
function toJsonPointer(path: readonly (PropertyKey | { readonly key: PropertyKey })[]): string {
  return path
    .map((segment) => String(segmentKey(segment)).replace(/~/g, "~0").replace(/\//g, "~1"))
    .map((token) => `/${token}`)
    .join("");
}

function boundParams(issue: ValidationIssue): Record<string, number> | undefined {
  const name = BOUND_PARAM_BY_VALIDATION_TYPE[issue.type ?? ""];

  return name !== undefined && typeof issue.requirement === "number"
    ? { [name]: issue.requirement }
    : undefined;
}

// Valibot renders container types capitalized (`Object`, `Array`, `Date`); lowercasing lands them
// on the JSON Schema type names a caller already reads in the OpenAPI document.
function expectedTypeParams(issue: ValidationIssue): Record<string, string> | undefined {
  return issue.expected ? { expected: issue.expected.toLowerCase() } : undefined;
}

function toCodeAndParams(issue: ValidationIssue): Pick<ProblemFieldError, "code" | "params"> {
  if (issue.received === UNDEFINED_RECEIVED) {
    return { code: "required" };
  }

  const type = issue.type ?? "";

  if (issue.kind === "schema") {
    return VALUE_SCHEMA_TYPES.has(type)
      ? { code: "invalid_value" }
      : { code: "invalid_type", params: expectedTypeParams(issue) };
  }

  if (type === INTEGER_VALIDATION_TYPE) {
    return { code: "invalid_type", params: { expected: INTEGER_VALIDATION_TYPE } };
  }

  if (FORMAT_VALIDATION_TYPES.has(type)) {
    return { code: "invalid_format", params: { format: type } };
  }

  const bounds = boundParams(issue);

  // A bounded validation without a numeric requirement, and every custom `check`, degrade to the
  // generic refusal rather than inventing a code no client could have been told about.
  return bounds ? { code: type as FieldErrorCode, params: bounds } : { code: "invalid_value" };
}

export function toFieldError({
  issue,
  target,
}: {
  issue: ValidationIssue;
  target: string;
}): ProblemFieldError {
  const { code, params } = toCodeAndParams(issue);

  return {
    in: LOCATION_BY_TARGET[target] ?? "body",
    pointer: toJsonPointer(issue.path ?? []),
    code,
    ...(params ? { params } : {}),
  };
}
