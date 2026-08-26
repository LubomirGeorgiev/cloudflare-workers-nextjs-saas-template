import "server-only";

import { Hono } from "hono";

import { jsonResponse } from "@/api/openapi";
import { API_TAGS } from "@/api/openapi-document";
import { apiOperation } from "@/api/operation";
import type { ApiEnv } from "@/api/types";
import { requirePrincipal, type ApiPrincipal } from "@/lib/api/principal";
import type { v } from "@/lib/validation";
import { credentialSchema } from "@/schemas/api/credential.schema";

// Read off the audience the principal always carries, so the id survives even after the owner has
// lost the membership — the state that makes a team key inert. Id only: name and slug stay behind
// the `teams:read` scope that this route deliberately does not require.
function toTeamDto(principal: ApiPrincipal): v.InferOutput<typeof credentialSchema>["team"] {
  const { audience } = principal;

  return audience.type === "team" ? { id: audience.teamId } : null;
}

// Typed against the documented schema: a field renamed on one side without the other is a
// compile error, not a wrong public document that still passes CI.
function toCredentialDto(principal: ApiPrincipal): v.InferOutput<typeof credentialSchema> {
  return {
    kind: principal.kind,
    audience: principal.audience.type,
    team: toTeamDto(principal),
    scopes: principal.scopes,
  };
}

export const credentialRoutes = new Hono<ApiEnv>().get(
  "/credential",
  ...apiOperation({
    operationId: "getCredential",
    tags: [API_TAGS.account],
    summary: "Describe the calling credential",
    description:
      "Returns what the credential making this request is: how it was issued, whether it acts " +
      "for the whole account or for one team, the id of that team when it has one, and the " +
      "scopes in force. Call this first when a request is refused, to see what this credential " +
      "may actually do — the scopes listed are the ones enforced, which can be narrower than the " +
      "set the credential was issued with. Requires no scope, so it answers whatever the caller " +
      "holds; it reports only the caller's own grant and never the account behind it, so the " +
      "team is an id and nothing more. Use getTeam for the team name and slug, and getMe for the " +
      "account profile, which a team-scoped API key cannot reach.",
    // The only `scope: null` in the API, and the route-table audit pins it there. Gating
    // credential introspection behind a scope would fail exactly the caller it exists for: one
    // that does not know what it holds.
    scope: null,
    audience: "any",
    responses: {
      200: jsonResponse({ description: "The calling credential.", schema: credentialSchema }),
    },
  }),
  (c) => c.json(toCredentialDto(requirePrincipal())),
);
