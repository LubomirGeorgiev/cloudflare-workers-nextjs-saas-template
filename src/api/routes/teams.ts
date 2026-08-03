import "server-only";

import { Hono } from "hono";

import { apiValidator, teamIdParam } from "@/api/middleware/problem-json";
import { apiOperation } from "@/api/operation";
import { API_TAGS } from "@/api/openapi-document";
import { jsonResponse } from "@/api/openapi";
import type { ApiEnv } from "@/api/types";
import { createTeam, getTeamForCaller, getUserTeams, renameTeam } from "@/lib/teams/teams";

import { teamListSchema, teamSchema, updateTeamSchema } from "@/schemas/api/teams.schema";
import { createTeamSchema } from "@/schemas/team.schema";

export const teamRoutes = new Hono<ApiEnv>()
  .get(
    "/teams",
    ...apiOperation({
      operationId: "listTeams",
      tags: [API_TAGS.teams],
      summary: "List the caller's teams",
      description:
        "Lists every team the authenticated account is an active member of, with the account's " +
        "role in each. Teams whose membership is inactive or expired are omitted. A team-scoped API " +
        "key lists only the single team it is scoped to.",
      scope: "teams:read",
      audience: "any",
      responses: {
        200: jsonResponse({ description: "The caller's teams.", schema: teamListSchema }),
      },
    }),
    async (c) => {
      return c.json(await getUserTeams());
    },
  )
  .post(
    "/teams",
    ...apiOperation({
      operationId: "createTeam",
      tags: [API_TAGS.teams],
      summary: "Create a team",
      description:
        "Creates a team owned by the authenticated account, which also becomes its first member. " +
        "The slug is derived from the name. Fails with 403 when the account is at its team limit. " +
        "Account-level: a team-scoped API key is refused with 403.",
      scope: "teams:write",
      audience: "account",
      responses: {
        201: jsonResponse({ description: "The created team.", schema: teamSchema }),
      },
    }),
    apiValidator("json", createTeamSchema),
    async (c) => {
      return c.json(await createTeam(c.req.valid("json")), 201);
    },
  )
  .get(
    "/teams/:teamId",
    ...apiOperation({
      operationId: "getTeam",
      tags: [API_TAGS.teams],
      summary: "Get a team",
      description:
        "Returns one team the authenticated account belongs to. Teams the account is not an " +
        "active member of answer 404, never 403, so team ids cannot be probed.",
      scope: "teams:read",
      audience: "team",
      responses: {
        200: jsonResponse({ description: "The team.", schema: teamSchema }),
      },
    }),
    teamIdParam(),
    async (c) => {
      return c.json(await getTeamForCaller(c.req.valid("param").teamId));
    },
  )
  .patch(
    "/teams/:teamId",
    ...apiOperation({
      operationId: "updateTeam",
      tags: [API_TAGS.teams],
      summary: "Rename a team",
      description:
        "Changes a team's display name. Requires the `edit_team_settings` permission on that team. " +
        "The slug is deliberately left alone so existing links and invitations keep working.",
      scope: "teams:write",
      audience: "team",
      responses: {
        200: jsonResponse({ description: "The renamed team.", schema: teamSchema }),
      },
    }),
    teamIdParam(),
    apiValidator("json", updateTeamSchema),
    async (c) => {
      const { teamId } = c.req.valid("param");
      const { name } = c.req.valid("json");

      return c.json(await renameTeam({ teamId, name }));
    },
  );
