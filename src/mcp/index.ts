import "server-only";

import { createMcpHandler } from "agents/mcp/server";
import type { McpServer } from "@modelcontextprotocol/server";

import { apiApp } from "@/api";
import { apiDocument } from "@/api/generated-document";
import { MCP_PATH, SITE_NAME } from "@/constants";
import { hasScope, type ApiPrincipal } from "@/lib/api/principal";
import { isApiScope } from "@/lib/api/scopes";
import { buildDerivedMcpServer } from "@/mcp/derived-server";
import type { McpToolDescriptor } from "@/mcp/derive-tools";
import { requireMcpPrincipal } from "@/mcp/principal";

// The remote MCP server. Tools are derived from the same OpenAPI document the docs UI reads, so a
// fork that adds a REST endpoint gets an agent tool for free. Both credential types arrive the
// same way: the OAuth provider validates them and puts the bearer props on the auth context.
//
// The registration plumbing lives in `./derived-server.ts`, shared with the internal server.

const MISSING_CREDENTIAL = "The MCP endpoint requires an authenticated credential.";

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

// Keeps `tools/list` honest: a credential never sees a tool whose operation it could not call.
// An operation declaring a scope outside the catalog fails closed rather than becoming public.
function isReachable({
  descriptor,
  principal,
}: {
  descriptor: McpToolDescriptor;
  principal: ApiPrincipal;
}): boolean {
  // A team credential is refused every account-level operation whatever its scopes, so those tools
  // are categorically dead for it: no argument makes them succeed. Team tools stay listed — only a
  // wrong-team argument is refused, and that refusal names the credential's own team.
  if (principal.audience.type === "team" && descriptor.audience === "account") {
    return false;
  }

  // An operation reaches this with no scope only when the document lists none for it, which the
  // route-table audit pins to credential introspection — a GET that reports the caller's own
  // grant. Listing that for every credential tells a confused caller what it holds.
  if (!descriptor.scope) {
    return true;
  }

  return isApiScope(descriptor.scope) && hasScope(principal, descriptor.scope);
}

async function createMcpServer({ requestInfo }: { requestInfo?: Request }) {
  const principal = await requireMcpPrincipal({ missingCredentialMessage: MISSING_CREDENTIAL });

  return buildDerivedMcpServer({
    name: `${SITE_NAME} MCP`,
    document: apiDocument(),
    app: apiApp,
    principal,
    requestInfo,
    isReachable: (descriptor) => isReachable({ descriptor, principal }),
    registerExtraTools: registerCustomTools,
  });
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
