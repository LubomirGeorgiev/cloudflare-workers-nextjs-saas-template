import "server-only";

import { createMcpHandler } from "agents/mcp/server";

import { adminApiApp } from "@/api/admin";
import { adminApiDocument } from "@/api/admin/generated-document";
import { ADMIN_MCP_PATH, SITE_NAME } from "@/constants";
import { ActionError } from "@/lib/action-error";
import { assertAdminPrincipal } from "@/lib/admin/admin-principal";
import { isAdminScope, type AdminScope } from "@/lib/api/admin-scopes";
import { actionErrorToProblem, toProblemResponse } from "@/lib/api/errors";
import type { ApiPrincipal } from "@/lib/api/principal";
import { buildDerivedMcpServer } from "@/mcp/derived-server";
import type { McpToolDescriptor } from "@/mcp/derive-tools";
import { requireMcpPrincipal, resolveMcpPrincipal } from "@/mcp/principal";

// The internal MCP server. Same derivation and the same plumbing as the public one in `./index.ts`
// — a different document and a different app, which is the whole reason those are two artifacts.
//
// Unadvertised: this endpoint is absent from the RFC 9727 catalog, from llms.txt, and from every
// `WWW-Authenticate` challenge the public surface sends. Staff find it on the admin panel page.
// The refusal below keeps that property: it adds no challenge header and names no endpoint.

const MISSING_CREDENTIAL = "The admin MCP endpoint requires an authenticated credential.";

// The scope named when a credential carries nothing internal at all. Only a live admin ever reads
// it; every other caller is refused on audience or role first, with the neutral sentence.
const SESSION_SCOPE_FALLBACK: AdminScope = "admin:read";

/**
 * Any internal scope opens a session, not `admin:read` specifically: `adminSetUserRole`,
 * `adminSetOAuthAppVerified`, and `adminPublishCmsEntry` declare `admin:write` alone, so a
 * write-only key is mintable and must be able to connect. `isReachable` then hides the tools it
 * cannot call, and each call re-asserts its own scope through the route's own guard.
 */
function sessionScope(principal: ApiPrincipal): AdminScope {
  return principal.scopes.find(isAdminScope) ?? SESSION_SCOPE_FALLBACK;
}

/**
 * Fails closed. Every internal operation declares an `admin:*` scope, so a descriptor whose scope
 * is missing or outside the internal catalog is a document this code does not understand — it is
 * dropped rather than offered.
 */
function isReachable({
  descriptor,
  principal,
}: {
  descriptor: McpToolDescriptor;
  principal: ApiPrincipal;
}): boolean {
  if (!descriptor.scope || !isAdminScope(descriptor.scope)) {
    return false;
  }

  return principal.scopes.includes(descriptor.scope);
}

/**
 * The session is authorized at the HTTP boundary below, so this only re-reads who the caller is.
 * A non-admin credential therefore never reaches a single tool listing.
 */
async function createAdminMcpServer({ requestInfo }: { requestInfo?: Request }) {
  const principal = await requireMcpPrincipal({ missingCredentialMessage: MISSING_CREDENTIAL });

  return buildDerivedMcpServer({
    name: `${SITE_NAME} admin MCP`,
    document: adminApiDocument(),
    app: adminApiApp,
    principal,
    requestInfo,
    isReachable: (descriptor) => isReachable({ descriptor, principal }),
  });
}

// Stateless Streamable HTTP, matching the public server. Origin/Host validation is left to the
// endpoint's own hostname because the request has already passed through the entrypoint and the
// OAuth provider by the time it gets here.
const adminMcpHandler = createMcpHandler(createAdminMcpServer, {
  route: ADMIN_MCP_PATH,
  allowedOriginHostnames: "*",
});

/**
 * Authorization runs here rather than in the factory, and that placement is the point:
 * `createMcpHandler` awaits the factory inside a `try` and maps any throw to HTTP 500 with JSON-RPC
 * `-32603`, so an expected refusal would read as an outage. Here it becomes the same problem+json
 * document the REST surface answers with, and the handler never runs.
 *
 * @returns the refusal response, or `null` when the caller may open a session.
 */
async function refuseUnauthorized({
  request,
  ctx,
}: {
  request: Request;
  ctx: ExecutionContext;
}): Promise<Response | null> {
  try {
    // The OAuth provider validated the credential and left its props on `ctx`. They are read from
    // there because the handler's own auth context does not exist until the factory runs.
    const principal = await resolveMcpPrincipal(ctx.props);

    if (!principal) {
      throw new ActionError("NOT_AUTHORIZED", MISSING_CREDENTIAL);
    }

    await assertAdminPrincipal({ scope: sessionScope(principal), principal });

    return null;
  } catch (error) {
    return toProblemResponse(actionErrorToProblem({ error, request }));
  }
}

/** Mounted on the OAuth provider's `apiHandlers`, which is what authenticates the request. */
export const adminMcpApiHandler = {
  fetch: async (request: Request, workerEnv: Env, ctx: ExecutionContext): Promise<Response> => {
    const refusal = await refuseUnauthorized({ request, ctx });

    return refusal ?? (await adminMcpHandler(request, workerEnv, ctx));
  },
};
