import "server-only";

import { env } from "cloudflare:workers";
import { fromJsonSchema, McpServer, type JsonSchemaType } from "@modelcontextprotocol/server";
import type { OpenAPIV3_1 } from "openapi-types";

import type { ApiApp } from "@/api/types";
import { API_VERSION, SITE_DOMAIN } from "@/constants";
import { runWithPrincipal, type ApiPrincipal } from "@/lib/api/principal";
import { deriveMcpTools, type McpToolDescriptor } from "@/mcp/derive-tools";
import { buildToolRequest, toToolResult } from "@/mcp/tool-request";

// The half of an MCP server that is identical whichever document it derives from: compiling each
// tool's schema, dispatching a call in-process, and registering the tools a principal can reach.
//
// Both servers are built on this — the public one from the published document against `apiApp`,
// the internal one from the admin document against `adminApiApp`. What differs is the document,
// the app, and the reachability rule, so those are the parameters.

interface McpToolRegistration {
  descriptor: McpToolDescriptor;
  /** Everything `registerTool` reads apart from the callback, which is the only per-request half. */
  config: ReturnType<typeof buildToolConfig>;
}

// `fromJsonSchema` is not a wrapper — it compiles the schema, walking the whole tree — so it must
// not run per request for schemas that never change within an isolate.
function buildToolConfig(descriptor: McpToolDescriptor) {
  return {
    title: descriptor.title,
    description: descriptor.description,
    inputSchema: fromJsonSchema<Record<string, unknown>>(descriptor.inputSchema as JsonSchemaType),
    ...(descriptor.outputSchema
      ? { outputSchema: fromJsonSchema(descriptor.outputSchema as JsonSchemaType) }
      : {}),
  };
}

// Keyed on the document object, which each generated module memoizes per isolate. The transport is
// stateless, so every JSON-RPC POST rebuilds the server and re-registers every tool; without this
// each of those would recompile every schema.
const registrationsByDocument = new WeakMap<object, McpToolRegistration[]>();

function loadToolRegistrations(document: OpenAPIV3_1.Document): McpToolRegistration[] {
  const cached = registrationsByDocument.get(document);
  if (cached) {
    return cached;
  }

  const registrations = deriveMcpTools({ document }).map((descriptor) => ({
    descriptor,
    config: buildToolConfig(descriptor),
  }));

  registrationsByDocument.set(document, registrations);

  return registrations;
}

// In-process dispatch: the tool calls the Hono app directly rather than fetching our own URL, which
// a Worker cannot do (error 1042) and which would cost a second request anyway. The principal
// travels through AsyncLocalStorage, so the API's auth middleware reuses it verbatim.
async function dispatch({
  descriptor,
  args,
  origin,
  principal,
  app,
}: {
  descriptor: McpToolDescriptor;
  args: Record<string, unknown>;
  origin: string;
  principal: ApiPrincipal;
  app: ApiApp;
}): Promise<Response> {
  const request = buildToolRequest({ descriptor, args, origin });

  // `app.fetch` is typed as sync-or-async; awaiting inside the ALS run keeps the principal in
  // scope for the whole handler either way.
  return runWithPrincipal(principal, () => app.fetch(request, env as Env));
}

function registerDerivedTool({
  server,
  registration,
  origin,
  principal,
  app,
}: {
  server: McpServer;
  registration: McpToolRegistration;
  origin: string;
  principal: ApiPrincipal;
  app: ApiApp;
}): void {
  const { descriptor, config } = registration;
  const callback = async (args: Record<string, unknown>) =>
    toToolResult({
      descriptor,
      response: await dispatch({ descriptor, args: args ?? {}, origin, principal, app }),
    });

  // The SDK's overloads infer the tool's argument type from a statically known schema; ours is
  // built from the document at runtime, so the pair is asserted here rather than inferred.
  (server.registerTool as (name: string, config: unknown, cb: unknown) => unknown)(
    descriptor.name,
    config,
    callback,
  );
}

/**
 * Build the server for one request: register every tool this principal can reach, then let the
 * caller add its own.
 */
export function buildDerivedMcpServer({
  name,
  document,
  app,
  principal,
  requestInfo,
  isReachable,
  registerExtraTools,
}: {
  name: string;
  document: OpenAPIV3_1.Document;
  app: ApiApp;
  principal: ApiPrincipal;
  requestInfo?: Request;
  /** Keeps `tools/list` honest: a credential never sees a tool whose operation it could not call. */
  isReachable: (descriptor: McpToolDescriptor) => boolean;
  registerExtraTools?: (params: { server: McpServer; principal: ApiPrincipal }) => void;
}): McpServer {
  const server = new McpServer({ name, version: API_VERSION });
  const origin = requestInfo ? new URL(requestInfo.url).origin : `https://${SITE_DOMAIN}`;

  for (const registration of loadToolRegistrations(document)) {
    if (!isReachable(registration.descriptor)) {
      continue;
    }

    registerDerivedTool({ server, registration, origin, principal, app });
  }

  registerExtraTools?.({ server, principal });

  return server;
}
