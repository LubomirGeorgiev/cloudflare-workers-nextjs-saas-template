import "server-only";

import { getMcpAuthContext } from "agents/mcp/server";

import type { ApiPrincipal } from "@/lib/api/principal";
import { principalFromBearerProps } from "@/lib/oauth/bearer-props";

// Both MCP servers turn a bearer credential into a principal the same way. This lives in its own
// module because the public server and the internal one must never import each other: a single
// import edge would pull the public app into the internal bundle, or the reverse.

/**
 * Pass `props` at the HTTP boundary, where `ctx.props` is the only source: the `agents` handler
 * establishes its auth context around the server factory, so `getMcpAuthContext()` is still empty
 * before that. Inside a factory, omit it.
 */
export async function resolveMcpPrincipal(props?: unknown): Promise<ApiPrincipal | null> {
  return await principalFromBearerProps(props ?? getMcpAuthContext()?.props);
}

/** The same resolution for a caller that treats a missing credential as impossible. */
export async function requireMcpPrincipal({
  missingCredentialMessage,
  props,
}: {
  missingCredentialMessage: string;
  props?: unknown;
}): Promise<ApiPrincipal> {
  const principal = await resolveMcpPrincipal(props);

  if (!principal) {
    throw new Error(missingCredentialMessage);
  }

  return principal;
}
