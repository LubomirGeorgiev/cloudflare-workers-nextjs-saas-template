import "server-only";

import { Hono } from "hono";

import { toNullableIsoString } from "@/utils/iso-timestamp";
import { apiValidator, teamIdParam } from "@/api/middleware/problem-json";
import { apiOperation } from "@/api/operation";
import { API_TAGS } from "@/api/openapi-document";
import { jsonResponse } from "@/api/openapi";
import type { ApiEnv } from "@/api/types";
import type { v } from "@/lib/validation";
import { getTeamMemberManagementData, removeTeamMember } from "@/lib/teams/team-members";
import { successSchema } from "@/schemas/api/common.schema";
import { teamMemberListSchema, type teamMemberSchema } from "@/schemas/api/members.schema";
import { removeMemberSchema } from "@/schemas/team-membership.schema";

type TeamMemberRecord = Awaited<
  ReturnType<typeof getTeamMemberManagementData>
>["members"][number];

// Typed against the documented schema, so renaming a field here without renaming it there (or
// vice versa) is a compile error rather than a wrong public document with green CI.
function toTeamMemberDto(member: TeamMemberRecord): v.InferOutput<typeof teamMemberSchema> {
  return {
    membershipId: member.id,
    userId: member.userId,
    email: member.user.email,
    firstName: member.user.firstName ?? null,
    lastName: member.user.lastName ?? null,
    avatar: member.user.avatar ?? null,
    roleId: member.roleId,
    roleName: member.roleName,
    isSystemRole: member.isSystemRole,
    isActive: member.isActive,
    joinedAt: toNullableIsoString(member.joinedAt),
  };
}

export const memberRoutes = new Hono<ApiEnv>()
  .get(
    "/teams/:teamId/members",
    ...apiOperation({
      operationId: "listTeamMembers",
      tags: [API_TAGS.members],
      summary: "List team members",
      description:
        "Lists every membership of a team with the member's identity, role, and join date. " +
        "Requires the `access_dashboard` permission on that team.",
      scope: "members:read",
      audience: "team",
      responses: {
        200: jsonResponse({ description: "The team's members.", schema: teamMemberListSchema }),
      },
    }),
    teamIdParam(),
    async (c) => {
      const { members } = await getTeamMemberManagementData(c.req.valid("param").teamId);

      return c.json(members.map(toTeamMemberDto));
    },
  )
  .delete(
    "/teams/:teamId/members/:userId",
    ...apiOperation({
      operationId: "removeTeamMember",
      tags: [API_TAGS.members],
      summary: "Remove a team member",
      description:
        "Removes a member from a team. Requires the `remove_members` permission on that team; " +
        "the team owner can never be removed this way.",
      scope: "members:write",
      audience: "team",
      responses: {
        200: jsonResponse({ description: "The member was removed.", schema: successSchema }),
      },
    }),
    apiValidator("param", removeMemberSchema),
    async (c) => {
      const { teamId, userId } = c.req.valid("param");

      return c.json(await removeTeamMember({ teamId, userId }));
    },
  );
