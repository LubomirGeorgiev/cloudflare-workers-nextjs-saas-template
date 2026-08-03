import type { OpenAPIV3_1 } from "openapi-types";

import { audienceOfOperation, type ApiOperationAudience } from "@/lib/api/audience";
import { MCP_EXTENSION_KEY } from "@/lib/api/openapi-extensions";
import {
  isReference,
  isSchemaObject,
  scopeOfOperation,
  walkOperations,
  type HttpMethod,
  JSON_CONTENT_TYPE,
} from "@/lib/api/openapi-walk";
import { MCP_TOOL_OVERRIDES, type McpToolOverride } from "@/mcp/tool-overrides";

// Pure derivation of the MCP tool surface from the generated OpenAPI 3.1 document. Deliberately
// free of `server-only` and of any runtime import, so the whole mapping is unit-testable and the
// heavy half (building the document, talking to the API) stays in `src/mcp/index.ts`.

/** Argument name a non-object request body rides in, since tool arguments are always an object. */
export const WRAPPED_BODY_ARGUMENT = "body";

interface JsonSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface McpToolDescriptor {
  /** The tool name advertised to agents: the operationId unless an override renames it. */
  name: string;
  title: string;
  description: string;
  operationId: string;
  /** Uppercase HTTP method of the REST operation this tool dispatches to. */
  method: string;
  /** OpenAPI path template including the API base path, e.g. `/api/v1/teams/{teamId}`. */
  path: string;
  /** The single catalog scope the operation declares, or null when it declares none. */
  scope: string | null;
  /** Which credentials the operation admits; an unreadable declaration fails closed to `account`. */
  audience: ApiOperationAudience;
  pathParams: string[];
  queryParams: string[];
  /** Body fields flattened into the tool arguments; empty when the body is wrapped or absent. */
  bodyParams: string[];
  /** True when the request body is not an object and travels in the `body` argument. */
  wrapsBody: boolean;
  inputSchema: JsonSchemaObject;
  /** Only set for object-shaped success responses — `structuredContent` must be an object. */
  outputSchema?: JsonSchemaObject;
}

/** `x-mcp: false` on an operation hides it; anything else (including absent) keeps it. */
function isHiddenFromMcp(operation: OpenAPIV3_1.OperationObject): boolean {
  return (operation as Record<string, unknown>)[MCP_EXTENSION_KEY] === false;
}

function bodySchema(operation: OpenAPIV3_1.OperationObject): Record<string, unknown> | null {
  const requestBody = operation.requestBody;
  if (!requestBody || isReference(requestBody)) {
    return null;
  }

  const schema = requestBody.content?.[JSON_CONTENT_TYPE]?.schema;

  return isSchemaObject(schema) ? schema : null;
}

function successSchema(operation: OpenAPIV3_1.OperationObject): Record<string, unknown> | null {
  const responses = operation.responses ?? {};
  const status = Object.keys(responses).find((code) => code.startsWith("2"));
  const response = status ? responses[status] : undefined;
  if (!response || isReference(response)) {
    return null;
  }

  const schema = response.content?.[JSON_CONTENT_TYPE]?.schema;

  return isSchemaObject(schema) ? schema : null;
}

function outputSchemaFor(operation: OpenAPIV3_1.OperationObject): JsonSchemaObject | undefined {
  const schema = successSchema(operation);

  if (!schema || schema.type !== "object" || !isSchemaObject(schema.properties)) {
    return undefined;
  }

  return {
    type: "object",
    properties: schema.properties as Record<string, unknown>,
    ...(Array.isArray(schema.required) ? { required: schema.required as string[] } : {}),
  };
}

interface InputShape {
  inputSchema: JsonSchemaObject;
  pathParams: string[];
  queryParams: string[];
  bodyParams: string[];
  wrapsBody: boolean;
}

interface Accumulator {
  properties: Record<string, unknown>;
  required: string[];
}

// Header and cookie parameters are transport concerns the dispatcher owns, never tool arguments.
function collectParameters({
  operation,
  into,
}: {
  operation: OpenAPIV3_1.OperationObject;
  into: Accumulator;
}): { pathParams: string[]; queryParams: string[] } {
  const pathParams: string[] = [];
  const queryParams: string[] = [];

  for (const parameter of operation.parameters ?? []) {
    if (isReference(parameter)) {
      continue;
    }
    if (parameter.in !== "path" && parameter.in !== "query") {
      continue;
    }

    into.properties[parameter.name] = {
      ...(isSchemaObject(parameter.schema) ? parameter.schema : {}),
      ...(parameter.description ? { description: parameter.description } : {}),
    };

    const isPath = parameter.in === "path";
    (isPath ? pathParams : queryParams).push(parameter.name);
    if (isPath || parameter.required) {
      into.required.push(parameter.name);
    }
  }

  return { pathParams, queryParams };
}

// One flat argument object cannot carry two fields of the same name, and dropping either half
// would send a request missing what the agent supplied. Refuse to derive instead, loudly enough
// that a fork sees it in its test run rather than as truncated tool calls in production.
function collisionError({
  operationId,
  names,
  fix,
}: {
  operationId: string;
  names: string[];
  fix: string;
}): Error {
  return new Error(
    `MCP tool derivation failed for operation "${operationId}": argument name(s) ` +
      `${names.map((name) => `"${name}"`).join(", ")} are claimed by both a path or query ` +
      `parameter and the request body, and one flat argument object cannot address both. ${fix} ` +
      "Alternatively, spread `hiddenFromMcp()` into the operation to keep it out of the tool surface.",
  );
}

function collectBody({
  operation,
  operationId,
  into,
}: {
  operation: OpenAPIV3_1.OperationObject;
  operationId: string;
  into: Accumulator;
}): { bodyParams: string[]; wrapsBody: boolean } {
  const body = bodySchema(operation);

  if (!body) {
    return { bodyParams: [], wrapsBody: false };
  }

  if (body.type !== "object" || !isSchemaObject(body.properties)) {
    if (WRAPPED_BODY_ARGUMENT in into.properties) {
      throw collisionError({
        operationId,
        names: [WRAPPED_BODY_ARGUMENT],
        fix: `A non-object request body rides in the reserved "${WRAPPED_BODY_ARGUMENT}" argument; rename the parameter.`,
      });
    }

    into.properties[WRAPPED_BODY_ARGUMENT] = body;
    into.required.push(WRAPPED_BODY_ARGUMENT);

    return { bodyParams: [], wrapsBody: true };
  }

  const bodyRequired = Array.isArray(body.required) ? (body.required as string[]) : [];
  const bodyParams: string[] = [];
  const collisions = Object.keys(body.properties).filter((name) => name in into.properties);

  if (collisions.length > 0) {
    throw collisionError({
      operationId,
      names: collisions,
      fix: "Rename the body field or the parameter so every argument is unique.",
    });
  }

  for (const [name, schema] of Object.entries(body.properties)) {
    into.properties[name] = schema;
    bodyParams.push(name);
    if (bodyRequired.includes(name)) {
      into.required.push(name);
    }
  }

  return { bodyParams, wrapsBody: false };
}

// Path parameters, query parameters, and the request body become one flat argument object: agents
// call a tool with a single JSON payload, not with three separately-addressed request parts.
function buildInputShape({
  operation,
  operationId,
}: {
  operation: OpenAPIV3_1.OperationObject;
  operationId: string;
}): InputShape {
  const accumulator: Accumulator = { properties: {}, required: [] };
  const { pathParams, queryParams } = collectParameters({ operation, into: accumulator });
  const { bodyParams, wrapsBody } = collectBody({ operation, operationId, into: accumulator });

  // Closed at the top level so an agent that sends an argument the operation does not accept is
  // told so, rather than having it silently dropped. Nested body schemas stay as the document
  // publishes them.
  return {
    inputSchema: {
      type: "object",
      properties: accumulator.properties,
      ...(accumulator.required.length ? { required: accumulator.required } : {}),
      additionalProperties: false,
    },
    pathParams,
    queryParams,
    bodyParams,
    wrapsBody,
  };
}

function describeTool({
  operation,
  override,
}: {
  operation: OpenAPIV3_1.OperationObject;
  override: McpToolOverride | undefined;
}): { title: string; description: string } {
  const summary = operation.summary ?? "";
  const description = operation.description ?? summary;

  return {
    title: override?.title ?? summary,
    description: override?.description ?? description,
  };
}

interface DeriveMcpToolsOptions {
  document: Pick<OpenAPIV3_1.Document, "paths">;
  /** Per-operation curation; defaults to the template's own map so forks edit one file. */
  overrides?: Record<string, McpToolOverride>;
}

/**
 * One tool per documented operation. `operationId` is the tool name (the OpenAPI document already
 * guarantees it exists and is unique), and operations hidden by `x-mcp: false` or by an override
 * never reach an agent at all.
 */
export function deriveMcpTools({
  document,
  overrides = MCP_TOOL_OVERRIDES,
}: DeriveMcpToolsOptions): McpToolDescriptor[] {
  const tools = [...walkOperations(document)].flatMap(({ path, method, operation }) => {
    const tool = toDescriptor({ path, method, operation, overrides });

    return tool ? [tool] : [];
  });

  return tools.sort((left, right) => left.name.localeCompare(right.name));
}

// Keyed on the document object, which the generated module memoizes per isolate: a page that
// renders per request derives the tool surface once, not once per render.
const toolNamesByDocument = new WeakMap<object, ReadonlyMap<string, string>>();

/**
 * operationId -> advertised tool name, for readers that only label operations. Uses the template's
 * own override map, so a renamed or hidden tool is reflected exactly as an agent sees it.
 *
 * Deliberately not `deriveMcpTools`: the docs page needs a label, not a tool, and would otherwise
 * pay for parameter walking, body flattening, JSON-Schema building, and collision checks it throws
 * away. Only the two rules that decide whether a name exists and what it is are applied here.
 */
export function mcpToolNameByOperationId(
  document: DeriveMcpToolsOptions["document"],
): ReadonlyMap<string, string> {
  const cached = toolNamesByDocument.get(document);
  if (cached) {
    return cached;
  }

  const names = new Map<string, string>();

  for (const { operation } of walkOperations(document)) {
    const operationId = operation.operationId;
    if (!operationId || isHiddenFromMcp(operation)) {
      continue;
    }

    const override = MCP_TOOL_OVERRIDES[operationId];
    if (override?.hidden) {
      continue;
    }

    names.set(operationId, override?.name ?? operationId);
  }

  toolNamesByDocument.set(document, names);

  return names;
}

function toDescriptor({
  path,
  method,
  operation,
  overrides,
}: {
  path: string;
  method: HttpMethod;
  operation: OpenAPIV3_1.OperationObject;
  overrides: Record<string, McpToolOverride>;
}): McpToolDescriptor | null {
  if (!operation.operationId || isHiddenFromMcp(operation)) {
    return null;
  }

  const override = overrides[operation.operationId];
  if (override?.hidden) {
    return null;
  }

  const outputSchema = outputSchemaFor(operation);

  return {
    name: override?.name ?? operation.operationId,
    operationId: operation.operationId,
    method: method.toUpperCase(),
    path,
    scope: scopeOfOperation(operation),
    audience: audienceOfOperation(operation),
    ...describeTool({ operation, override }),
    ...buildInputShape({ operation, operationId: operation.operationId }),
    ...(outputSchema ? { outputSchema } : {}),
  };
}
