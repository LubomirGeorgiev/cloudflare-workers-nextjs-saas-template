import "server-only";

import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { env } from "cloudflare:workers";
import { fromJsonSchema, McpServer, type JsonSchemaType } from "@modelcontextprotocol/server";

import { apiApp } from "@/api";
import { apiDocument } from "@/api/generated-document";
import { API_VERSION, MCP_PATH, SITE_DOMAIN, SITE_NAME } from "@/constants";
import { hasScope, runWithPrincipal, type ApiPrincipal } from "@/lib/api/principal";
import { isApiScope } from "@/lib/api/scopes";
import { principalFromBearerProps } from "@/lib/oauth/bearer-props";
import { deriveMcpTools, type McpToolDescriptor } from "@/mcp/derive-tools";
import { buildToolRequest, toToolResult } from "@/mcp/tool-request";

// The remote MCP server. Tools are derived from the same OpenAPI document the docs UI reads, so a
// fork that adds a REST endpoint gets an agent tool for free. Both credential types arrive the
// same way: the OAuth provider validates them and puts the bearer props on the auth context.

const MISSING_CREDENTIAL = "The MCP endpoint requires an authenticated credential.";

interface McpToolRegistration {
  descriptor: McpToolDescriptor;
  /** Everything `registerTool` reads apart from the callback, which is the only per-request half. */
  config: ReturnType<typeof buildToolConfig>;
}

// Memoized per isolate because the transport is stateless: every JSON-RPC POST rebuilds the server
// and re-registers every tool, and neither the derivation nor the compiled schemas can change
// within an isolate.
let registrations: McpToolRegistration[] | null = null;

// `fromJsonSchema` is not a wrapper — it compiles the schema into a validator, walking the whole
// tree — so it must not run per request for schemas that never change within an isolate.
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

function loadToolRegistrations(): McpToolRegistration[] {
  registrations ??= deriveMcpTools({ document: apiDocument() }).map((descriptor) => ({
    descriptor,
    config: buildToolConfig(descriptor),
  }));

  return registrations;
}

async function resolvePrincipal(): Promise<ApiPrincipal> {
  const principal = await principalFromBearerProps(getMcpAuthContext()?.props);

  if (!principal) {
    throw new Error(MISSING_CREDENTIAL);
  }

  return principal;
}

// ---------------------------------------------------------------------------
// Extension seam for downstream projects.
//
// Everything an endpoint can express already arrives as a derived tool. Register bespoke tools
// here — ones with no REST equivalent — and gate them on the principal's scopes yourself.
// ---------------------------------------------------------------------------
// oxlint-disable project/no-unused-module-exports -- Template extension point.
// fallow-ignore-next-line unused-export -- Intentionally empty until a fork registers its own tools.
export function registerCustomTools(__params: { server: McpServer; principal: ApiPrincipal }): void {}
// oxlint-enable project/no-unused-module-exports

// In-process dispatch: the tool calls the Hono app directly rather than fetching our own URL,
// which a Worker cannot do (error 1042) and which would cost a second request anyway. The
// principal travels through AsyncLocalStorage, so the API's auth middleware reuses it verbatim.
async function dispatch({
  descriptor,
  args,
  origin,
  principal,
}: {
  descriptor: McpToolDescriptor;
  args: Record<string, unknown>;
  origin: string;
  principal: ApiPrincipal;
}): Promise<Response> {
  const request = buildToolRequest({ descriptor, args, origin });

  return runWithPrincipal(principal, () => apiApp.fetch(request, env as Env));
}

function registerDerivedTool({
  server,
  registration,
  origin,
  principal,
}: {
  server: McpServer;
  registration: McpToolRegistration;
  origin: string;
  principal: ApiPrincipal;
}): void {
  const { descriptor, config } = registration;
  const callback = async (args: Record<string, unknown>) =>
    toToolResult({
      descriptor,
      response: await dispatch({ descriptor, args: args ?? {}, origin, principal }),
    });

  // The SDK's overloads infer the tool's argument type from a statically known schema; ours is
  // built from the document at runtime, so the pair is asserted here rather than inferred.
  (server.registerTool as (name: string, config: unknown, cb: unknown) => unknown)(
    descriptor.name,
    config,
    callback,
  );
}

// Keeps `tools/list` honest: a credential never sees a tool whose operation it could not call.
// An operation declaring a scope outside the catalog fails closed rather than becoming public.
function isReachable({ descriptor, principal }: { descriptor: McpToolDescriptor; principal: ApiPrincipal }): boolean {
  // A team credential is refused every account-level operation whatever its scopes, so those tools
  // are categorically dead for it: no argument makes them succeed. Team tools stay listed — only a
  // wrong-team argument is refused, and that refusal names the credential's own team.
  if (principal.audience.type === "team" && descriptor.audience === "account") {
    return false;
  }

  if (!descriptor.scope) {
    return true;
  }

  return isApiScope(descriptor.scope) && hasScope(principal, descriptor.scope);
}

async function createMcpServer({ requestInfo }: { requestInfo?: Request }): Promise<McpServer> {
  const principal = await resolvePrincipal();
  const tools = loadToolRegistrations();
  const server = new McpServer({ name: `${SITE_NAME} MCP`, version: API_VERSION });
  const origin = requestInfo ? new URL(requestInfo.url).origin : `https://${SITE_DOMAIN}`;

  for (const registration of tools) {
    if (!isReachable({ descriptor: registration.descriptor, principal })) {
      continue;
    }

    registerDerivedTool({ server, registration, origin, principal });
  }

  registerCustomTools({ server, principal });

  return server;
}

// Stateless Streamable HTTP; 2025-era clients keep working through the SDK's default legacy lane.
// Origin/Host validation is left to the endpoint's own hostname because the request has already
// passed through the entrypoint and the OAuth provider by the time it gets here.
const mcpHandler = createMcpHandler(createMcpServer, {
  route: MCP_PATH,
  allowedOriginHostnames: "*",
});

/** Mounted on the OAuth provider's `apiHandlers`, which is what authenticates the request. */
// fallow-ignore-next-line unused-export -- Reached by dynamic import from worker-entrypoint.ts.
export const mcpApiHandler = {
  fetch: (request: Request, workerEnv: Env, ctx: ExecutionContext): Promise<Response> =>
    mcpHandler(request, workerEnv, ctx),
};
