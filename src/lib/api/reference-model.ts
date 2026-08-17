import type { OpenAPIV3_1 } from "openapi-types";

import {
  asSchemaObject,
  isReference,
  operationAnchorId,
  scopeOfOperation,
  walkOperations,
  type HttpMethod,
  HTTP_METHODS,
  JSON_CONTENT_TYPE,
} from "@/lib/api/openapi-walk";
import { describeApiScope, isApiScope } from "@/lib/api/scopes";

// Pure view model behind `/docs/api`: turns the generated OpenAPI 3.1 document into rows a server
// component can render without a spec-viewer library. Deliberately free of `server-only`, of React,
// and of any runtime import, so the whole mapping is unit-testable. MCP tool names are passed in
// rather than derived here: the docs view model must not depend on the MCP package's policy.

/** Nested schemas stop expanding here; deeper shapes stay in the JSON example instead. */
const MAX_FIELD_DEPTH = 3;
/** Guards the example builder against a pathological (or accidentally recursive) schema. */
const MAX_EXAMPLE_DEPTH = 6;
const UNKNOWN_TYPE_LABEL = "unknown";
const ARRAY_ITEM_KEY_SUFFIX = "[]";
/** The single entry a map-shaped object (`additionalProperties`) is illustrated with. */
const ADDITIONAL_PROPERTY_EXAMPLE_KEY = "key";
/** `typeof` results a literal is labelled by directly; anything else is unknown. */
const LITERAL_TYPE_LABELS = ["boolean", "number", "object", "string"] as const;

/** operationId -> the name the operation is advertised under to agents. */
type McpToolNames = ReadonlyMap<string, string>;

const EMPTY_TOOL_NAMES: McpToolNames = new Map();

// Placeholder values keyed by JSON Schema `format`, so an example reads like a real payload rather
// than like the word "string" repeated.
const EXAMPLE_BY_FORMAT: Record<string, string> = {
  email: "user@example.com",
  uri: "https://example.com",
  url: "https://example.com",
  "date-time": "2026-01-01T00:00:00.000Z",
  date: "2026-01-01",
  uuid: "00000000-0000-0000-0000-000000000000",
};

// Rendered as-is next to a field; technical tokens, so they stay untranslated like the schema.
const NUMERIC_CONSTRAINT_KEYS = [
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
] as const;

// Ordered: the first bound a schema states decides the example. An exclusive bound is itself an
// invalid value, so `step` moves one off it.
const NUMERIC_EXAMPLE_BOUNDS = [
  { key: "minimum", round: Math.ceil, step: 0 },
  { key: "exclusiveMinimum", round: Math.floor, step: 1 },
  { key: "maximum", round: Math.floor, step: 0 },
  { key: "exclusiveMaximum", round: Math.ceil, step: -1 },
] as const;

export interface SchemaFieldView {
  /** React identity, unique within one rendered list; never rendered. */
  key: string;
  /** The token the row shows: a body field's dotted path, `role.name`, `scopes[]`. */
  label: string;
  /** Nesting level, for indentation only. */
  depth: number;
  typeLabel: string;
  required: boolean;
  nullable: boolean;
  description: string | null;
  /** `maxLength 100`, `format: email`, `default: true` — shown as code chips. */
  constraints: string[];
  enumValues: string[];
}

interface SchemaView {
  /** Label for the payload as a whole: `object`, `object[]`, `string`. */
  typeLabel: string;
  contentType: string;
  fields: SchemaFieldView[];
  example: unknown;
}

export interface ParameterView {
  name: string;
  location: string;
  required: boolean;
  typeLabel: string;
  description: string | null;
  constraints: string[];
}

export interface ResponseView {
  status: string;
  description: string;
  schema: SchemaView | null;
}

export interface OperationView {
  /** Fragment this operation is addressable by, e.g. `operation-listTeams`. */
  anchorId: string;
  operationId: string;
  method: string;
  /** Full path template including the API base path. */
  path: string;
  /** First declared tag; the group this operation is rendered under. */
  tag: string;
  summary: string;
  description: string;
  scope: string | null;
  scopeDescription: string | null;
  /** Tool name when the operation is also exposed over MCP, else null. */
  mcpToolName: string | null;
  parameters: ParameterView[];
  requestBody: SchemaView | null;
  successResponses: ResponseView[];
  errorResponses: ResponseView[];
  curl: string;
  /** Lowercased haystack the client-side filter matches its tokens against. */
  searchText: string;
}

interface OperationGroupView {
  name: string;
  operations: OperationView[];
}

export interface ApiReferenceView {
  title: string;
  description: string;
  version: string;
  /** `servers[0].url`: the origin every operation path is resolved against. */
  baseUrl: string;
  groups: OperationGroupView[];
  operationCount: number;
  /** Methods the document actually uses, so the filter offers no dead chip. */
  methods: string[];
}

function isNullSchema(schema: Record<string, unknown>): boolean {
  return schema.type === "null";
}

interface ResolvedSchema {
  schema: Record<string, unknown> | null;
  nullable: boolean;
  /** Branch labels when a union has more than one non-null member. */
  unionLabels: string[];
}

// OpenAPI 3.1 spells "nullable" three ways: `anyOf`/`oneOf` with a null branch, or `type` as an
// array. All three must collapse to one field row plus a nullable flag, or every optional column
// in the docs would read as an unexplained union.
function resolveSchema(input: unknown): ResolvedSchema {
  const schema = asSchemaObject(input);

  if (!schema) {
    return { schema: null, nullable: false, unionLabels: [] };
  }

  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((type): type is string => typeof type === "string");
    const concrete = types.filter((type) => type !== "null");

    return {
      schema: { ...schema, type: concrete[0] },
      nullable: types.length !== concrete.length,
      unionLabels: concrete.length > 1 ? concrete : [],
    };
  }

  const union = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : null;

  if (!union) {
    return { schema, nullable: false, unionLabels: [] };
  }

  const branches = union
    .map(asSchemaObject)
    .filter((branch): branch is Record<string, unknown> => branch !== null);
  const concrete = branches.filter((branch) => !isNullSchema(branch));
  const nullable = concrete.length !== branches.length;

  if (concrete.length === 1) {
    const resolved = resolveSchema(concrete[0]);

    return { ...resolved, nullable: nullable || resolved.nullable };
  }

  return {
    schema: concrete[0] ?? null,
    nullable,
    unionLabels: concrete.map((branch) => typeLabelFor(branch)),
  };
}

function literalTypeLabel(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }

  const literalType = typeof value;
  return LITERAL_TYPE_LABELS.some((label) => label === literalType)
    ? literalType
    : UNKNOWN_TYPE_LABEL;
}

function additionalPropertiesTypeLabel(schema: Record<string, unknown>): string | null {
  const additionalProperties = asSchemaObject(schema.additionalProperties);
  if (additionalProperties) {
    return `object<string, ${typeLabelFor(additionalProperties)}>`;
  }

  return schema.additionalProperties === true ? "object<string, unknown>" : null;
}

function typeLabelFor(input: unknown): string {
  const { schema, unionLabels } = resolveSchema(input);

  if (unionLabels.length > 1) {
    return unionLabels.join(" | ");
  }
  if (!schema) {
    return UNKNOWN_TYPE_LABEL;
  }

  // Before the const branch: a typed array with a const value still reads as `T[]`, not `array`.
  if (schema.type === "array") {
    return `${typeLabelFor(schema.items)}${ARRAY_ITEM_KEY_SUFFIX}`;
  }

  if (schema.const !== undefined) {
    return literalTypeLabel(schema.const);
  }

  if (schema.type === "object") {
    return additionalPropertiesTypeLabel(schema) ?? "object";
  }

  return typeof schema.type === "string" ? schema.type : UNKNOWN_TYPE_LABEL;
}

// An array of enums states its values on the item schema, so a `string[]` column still lists them.
function enumValuesFor(schema: Record<string, unknown>): string[] {
  const items = asSchemaObject(schema.items);
  const values = Array.isArray(schema.enum)
    ? schema.enum
    : items && Array.isArray(items.enum)
      ? items.enum
      : [];

  return values.map((value) => String(value));
}

function constraintsFor(schema: Record<string, unknown>): string[] {
  const constraints: string[] = [];

  if (typeof schema.format === "string") {
    constraints.push(`format: ${schema.format}`);
  }

  for (const key of NUMERIC_CONSTRAINT_KEYS) {
    if (typeof schema[key] === "number") {
      constraints.push(`${key} ${schema[key]}`);
    }
  }

  if (typeof schema.pattern === "string") {
    constraints.push(`pattern: ${schema.pattern}`);
  }
  if (schema.default !== undefined) {
    constraints.push(`default: ${JSON.stringify(schema.default)}`);
  }
  if (schema.const !== undefined) {
    constraints.push(`const: ${JSON.stringify(schema.const)}`);
  }

  return constraints;
}

/** The object whose properties become field rows: the schema itself, or an array's item schema. */
function expandableObject(schema: Record<string, unknown>): Record<string, unknown> | null {
  if (schema.type === "array") {
    const items = resolveSchema(schema.items).schema;

    return items && asSchemaObject(items.properties) ? items : null;
  }

  return asSchemaObject(schema.properties) ? schema : null;
}

function toFieldView({
  name,
  rawField,
  depth,
  prefix,
  isRequired,
}: {
  name: string;
  rawField: unknown;
  depth: number;
  prefix: string;
  isRequired: boolean;
}): SchemaFieldView {
  const { schema: field, nullable, unionLabels } = resolveSchema(rawField);

  const path = `${prefix}${name}`;

  return {
    key: path,
    label: path,
    depth,
    typeLabel: unionLabels.length > 1 ? unionLabels.join(" | ") : typeLabelFor(rawField),
    required: isRequired,
    nullable,
    description: field && typeof field.description === "string" ? field.description : null,
    constraints: field ? constraintsFor(field) : [],
    enumValues: field ? enumValuesFor(field) : [],
  };
}

function collectFields({
  schema,
  depth,
  prefix,
  into,
}: {
  schema: Record<string, unknown>;
  depth: number;
  prefix: string;
  into: SchemaFieldView[];
}): void {
  const properties = asSchemaObject(schema.properties);
  if (!properties) {
    return;
  }

  const required = Array.isArray(schema.required) ? schema.required.map(String) : [];

  for (const [name, rawField] of Object.entries(properties)) {
    const view = toFieldView({
      name,
      rawField,
      depth,
      prefix,
      isRequired: required.includes(name),
    });

    into.push(view);

    const field = resolveSchema(rawField).schema;
    const nested = field && depth + 1 < MAX_FIELD_DEPTH ? expandableObject(field) : null;
    if (!nested || !field) {
      continue;
    }

    const separator = field.type === "array" ? `${ARRAY_ITEM_KEY_SUFFIX}.` : ".";
    collectFields({ schema: nested, depth: depth + 1, prefix: `${view.key}${separator}`, into });
  }
}

/** The number a numeric leaf shows in an example: the first stated bound, kept inside its own schema. */
function numericExample(schema: Record<string, unknown>): number {
  const isInteger = schema.type === "integer";

  for (const { key, round, step } of NUMERIC_EXAMPLE_BOUNDS) {
    const bound = schema[key];

    if (typeof bound === "number") {
      return isInteger ? round(bound) + step : bound + step;
    }
  }

  return 0;
}

function scalarExample({
  schema,
  nullable,
}: {
  schema: Record<string, unknown>;
  nullable: boolean;
}): unknown {
  if (schema.type === "number" || schema.type === "integer") {
    return numericExample(schema);
  }
  if (schema.type === "boolean") {
    return true;
  }

  if (schema.type === "string") {
    const format = typeof schema.format === "string" ? schema.format : null;

    return (format && EXAMPLE_BY_FORMAT[format]) ?? "string";
  }

  return nullable ? null : "string";
}

function objectExample({
  schema,
  depth,
}: {
  schema: Record<string, unknown>;
  depth: number;
}): Record<string, unknown> {
  const properties = asSchemaObject(schema.properties);
  if (properties) {
    return Object.fromEntries(
      Object.entries(properties).map(([name, field]) => [
        name,
        buildExample({ input: field, depth: depth + 1 }),
      ]),
    );
  }

  const additionalProperties = asSchemaObject(schema.additionalProperties);
  if (additionalProperties) {
    return {
      [ADDITIONAL_PROPERTY_EXAMPLE_KEY]: buildExample({
        input: additionalProperties,
        depth: depth + 1,
      }),
    };
  }

  // `additionalProperties: true` is labelled `object<string, unknown>`, so the example must show
  // an entry too, or the label and the example would disagree.
  return schema.additionalProperties === true ? { [ADDITIONAL_PROPERTY_EXAMPLE_KEY]: "string" } : {};
}

function buildExample({ input, depth }: { input: unknown; depth: number }): unknown {
  const { schema, nullable } = resolveSchema(input);

  if (!schema || depth > MAX_EXAMPLE_DEPTH) {
    return null;
  }
  if (schema.const !== undefined) {
    return schema.const;
  }
  if (schema.default !== undefined) {
    return schema.default;
  }
  if (schema.example !== undefined) {
    return schema.example;
  }

  const enumValues = Array.isArray(schema.enum) ? schema.enum : [];
  if (enumValues.length > 0) {
    return enumValues[0];
  }

  if (schema.type === "array") {
    return [buildExample({ input: schema.items, depth: depth + 1 })];
  }

  if (schema.type === "object") {
    return objectExample({ schema, depth });
  }

  return scalarExample({ schema, nullable });
}

function buildSchemaView({
  input,
  contentType,
}: {
  input: unknown;
  contentType: string;
}): SchemaView | null {
  const { schema } = resolveSchema(input);
  if (!schema) {
    return null;
  }

  const fields: SchemaFieldView[] = [];
  const expandable = expandableObject(schema);

  if (expandable) {
    collectFields({ schema: expandable, depth: 0, prefix: "", into: fields });
  }

  return {
    typeLabel: typeLabelFor(schema),
    contentType,
    fields,
    example: buildExample({ input: schema, depth: 0 }),
  };
}

// The "else first key" arm is what keeps `application/problem+json` responses: the JSON media type
// alone would drop every error schema.
function preferredMediaType(content: Record<string, unknown> | undefined): string | null {
  if (!content) {
    return null;
  }
  if (content[JSON_CONTENT_TYPE]) {
    return JSON_CONTENT_TYPE;
  }

  return Object.keys(content)[0] ?? null;
}

function requestBodyView(operation: OpenAPIV3_1.OperationObject): SchemaView | null {
  const body = operation.requestBody;
  if (!body || isReference(body)) {
    return null;
  }

  const contentType = preferredMediaType(body.content);

  return contentType
    ? buildSchemaView({ input: body.content?.[contentType]?.schema, contentType })
    : null;
}

function responseViews(operation: OpenAPIV3_1.OperationObject): ResponseView[] {
  return Object.entries(operation.responses ?? {}).flatMap(([status, response]) => {
    if (!response || isReference(response)) {
      return [];
    }

    const content = response.content;
    const mediaType = preferredMediaType(content);

    return [
      {
        status,
        description: response.description ?? "",
        schema: mediaType
          ? buildSchemaView({ input: content?.[mediaType]?.schema, contentType: mediaType })
          : null,
      },
    ];
  });
}

export function buildCurlSnippet({
  method,
  url,
  bodyExample,
  contentType,
}: {
  method: string;
  url: string;
  bodyExample: unknown;
  contentType: string;
}): string {
  const lines = [
    method === "GET" ? `curl "${url}"` : `curl -X ${method} "${url}"`,
    `  -H "Authorization: Bearer $API_KEY"`,
  ];

  if (bodyExample !== undefined && bodyExample !== null) {
    lines.push(`  -H "Content-Type: ${contentType}"`);
    lines.push(`  -d '${JSON.stringify(bodyExample, null, 2)}'`);
  }

  return lines.join(" \\\n");
}

function buildSearchText({
  operation,
  method,
  path,
  parameters,
  requestBody,
}: {
  operation: OpenAPIV3_1.OperationObject;
  method: string;
  path: string;
  parameters: ParameterView[];
  requestBody: SchemaView | null;
}): string {
  return [
    method,
    path,
    operation.operationId ?? "",
    operation.summary ?? "",
    operation.description ?? "",
    ...(operation.tags ?? []),
    scopeOfOperation(operation) ?? "",
    ...parameters.map((parameter) => parameter.name),
    ...(requestBody?.fields.map((field) => field.key) ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function toOperationView({
  path,
  method,
  operation,
  serverUrl,
  mcpToolNames,
}: {
  path: string;
  method: HttpMethod;
  operation: OpenAPIV3_1.OperationObject;
  serverUrl: string;
  mcpToolNames: McpToolNames;
}): OperationView | null {
  const operationId = operation.operationId;
  if (!operationId) {
    return null;
  }

  const parameters: ParameterView[] = (operation.parameters ?? []).flatMap((parameter) => {
    if (isReference(parameter)) {
      return [];
    }

    const { schema, nullable } = resolveSchema(parameter.schema);

    return [
      {
        name: parameter.name,
        location: parameter.in,
        required: parameter.required === true || parameter.in === "path",
        typeLabel: nullable ? `${typeLabelFor(parameter.schema)} | null` : typeLabelFor(parameter.schema),
        description: parameter.description ?? null,
        constraints: schema ? constraintsFor(schema) : [],
      },
    ];
  });

  const requestBody = requestBodyView(operation);
  const responses = responseViews(operation);
  const successResponses = responses.filter((response) => response.status.startsWith("2"));
  const errorResponses = responses.filter((response) => !response.status.startsWith("2"));
  const scope = scopeOfOperation(operation);
  const upperMethod = method.toUpperCase();

  return {
    anchorId: operationAnchorId(operationId),
    operationId,
    method: upperMethod,
    path,
    tag: operation.tags?.[0] ?? "",
    summary: operation.summary ?? operationId,
    description: operation.description ?? "",
    scope,
    scopeDescription: scope && isApiScope(scope) ? describeApiScope(scope) : null,
    mcpToolName: mcpToolNames.get(operationId) ?? null,
    parameters,
    requestBody,
    successResponses,
    errorResponses,
    curl: buildCurlSnippet({
      method: upperMethod,
      url: `${serverUrl}${path}`,
      bodyExample: requestBody?.example,
      contentType: requestBody?.contentType ?? JSON_CONTENT_TYPE,
    }),
    searchText: buildSearchText({ operation, method: upperMethod, path, parameters, requestBody }),
  };
}

/** Tag order follows `document.tags`; operations with an unlisted tag are appended in encounter order. */
function groupOperations({
  operations,
  tags,
}: {
  operations: OperationView[];
  tags: OpenAPIV3_1.TagObject[];
}): OperationGroupView[] {
  const grouped = new Map<string, OperationView[]>(tags.map((tag) => [tag.name, []]));

  for (const operation of operations) {
    const existing = grouped.get(operation.tag);

    if (existing) {
      existing.push(operation);
    } else {
      grouped.set(operation.tag, [operation]);
    }
  }

  return [...grouped.entries()]
    .filter(([, members]) => members.length > 0)
    .map(([name, members]) => ({ name, operations: members }));
}

export function buildApiReferenceView({
  document,
  mcpToolNames = EMPTY_TOOL_NAMES,
}: {
  document: OpenAPIV3_1.Document;
  /** operationId -> MCP tool name, supplied by the caller so the docs never import the MCP package. */
  mcpToolNames?: McpToolNames;
}): ApiReferenceView {
  const serverUrl = document.servers?.[0]?.url ?? "";

  const operations = [...walkOperations(document)].flatMap(({ path, method, operation }) => {
    const view = toOperationView({ path, method, operation, serverUrl, mcpToolNames });

    return view ? [view] : [];
  });

  return {
    title: document.info.title,
    description: document.info.description ?? "",
    version: document.info.version,
    baseUrl: serverUrl,
    groups: groupOperations({ operations, tags: document.tags ?? [] }),
    operationCount: operations.length,
    methods: HTTP_METHODS.map((method) => method.toUpperCase()).filter((method) =>
      operations.some((operation) => operation.method === method),
    ),
  };
}
