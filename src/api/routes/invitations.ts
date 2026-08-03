import "server-only";

import { Hono } from "hono";

import { toIsoString } from "@/utils/iso-timestamp";
import { apiValidator, teamIdParam } from "@/api/middleware/problem-json";
import { apiOperation } from "@/api/operation";
import { API_TAGS } from "@/api/openapi-document";
import { jsonResponse } from "@/api/openapi";
import type { ApiEnv } from "@/api/types";
import type { v } from "@/lib/validation";
import { getTeamMemberManagementData } from "@/lib/teams/team-members";
import { inviteUserToTeam } from "@/lib/teams/team-invite";
import { revokeTeamInvitation } from "@/lib/teams/team-invitation-revoke";
import { listTeamRoles } from "@/lib/teams/team-roles";
import { successSchema } from "@/schemas/api/common.schema";
import {
  createInvitationSchema,
  invitationListSchema,
  teamRoleListSchema,
  DEFAULT_INVITATION_ROLE_ID,
  type invitationSchema,
} from "@/schemas/api/invitations.schema";
import { revokeTeamInvitationSchema } from "@/schemas/team-membership.schema";

type PendingInvitation = Awaited<
  ReturnType<typeof getTeamMemberManagementData>
>["pendingInvitations"][number];

function toInvitationDto(
  invitation: PendingInvitation,
): v.InferOutput<typeof invitationSchema> {
  return {
    id: invitation.id,
    email: invitation.email,
    roleId: invitation.roleId,
    roleName: invitation.roleName,
    isSystemRole: invitation.isSystemRole,
    createdAt: toIsoString(invitation.createdAt),
    expiresAt: toIsoString(invitation.expiresAt),
  };
}

export const invitationRoutes = new Hono<ApiEnv>()
  .get(
    "/teams/:teamId/roles",
    ...apiOperation({
      operationId: "listTeamRoles",
      tags: [API_TAGS.invitations],
      summary: "List the roles a team can assign",
      description:
        "Lists every role id accepted by createTeamInvitation, with the permissions each one " +
        "grants. System roles (`owner`, `member`, `guest`) exist on every team and are passed " +
        "with `isSystemRole: true`; roles the team defined itself are passed with " +
        "`isSystemRole: false`. `isAssignable` is false for roles an invitation cannot grant, " +
        "such as `owner`. Requires the `access_dashboard` permission.",
      scope: "members:read",
      audience: "team",
      responses: {
        200: jsonResponse({
          description: "The roles this team can assign.",
          schema: teamRoleListSchema,
        }),
      },
    }),
    teamIdParam(),
    async (c) => c.json(await listTeamRoles(c.req.valid("param").teamId)),
  )
  .get(
    "/teams/:teamId/invitations",
    ...apiOperation({
      operationId: "listTeamInvitations",
      tags: [API_TAGS.invitations],
      summary: "List pending team invitations",
      description:
        "Lists invitations that have not been accepted and have not expired. Requires the " +
        "`invite_members` permission; callers without it receive an empty list, never invitee emails.",
      scope: "members:read",
      audience: "team",
      responses: {
        200: jsonResponse({
          description: "The team's pending invitations.",
          schema: invitationListSchema,
        }),
      },
    }),
    teamIdParam(),
    async (c) => {
      const { pendingInvitations } = await getTeamMemberManagementData(c.req.valid("param").teamId);

      return c.json(pendingInvitations.map(toInvitationDto));
    },
  )
  .post(
    "/teams/:teamId/invitations",
    ...apiOperation({
      operationId: "createTeamInvitation",
      tags: [API_TAGS.invitations],
      summary: "Invite someone to a team",
      description:
        "Sends an invitation email for a team seat. `roleId` is optional and defaults to " +
        `\`${DEFAULT_INVITATION_ROLE_ID}\`; call listTeamRoles for the other ids this team accepts, ` +
        "and pass `isSystemRole: false` alongside a role the team defined itself. Requires the " +
        "`invite_members` permission and a free seat on the team's plan — inviting past the seat " +
        "limit answers 403, and the response detail names the limit. The response never reveals " +
        "whether the address already has an account or is already a member.",
      scope: "invites:write",
      audience: "team",
      responses: {
        201: jsonResponse({ description: "The invitation was sent.", schema: successSchema }),
      },
    }),
    teamIdParam(),
    apiValidator("json", createInvitationSchema),
    async (c) => {
      const { teamId } = c.req.valid("param");
      const input = c.req.valid("json");

      const result = await inviteUserToTeam({ teamId, ...input });

      return c.json(result, 201);
    },
  )
  .delete(
    "/teams/:teamId/invitations/:invitationId",
    ...apiOperation({
      operationId: "revokeTeamInvitation",
      tags: [API_TAGS.invitations],
      summary: "Revoke a pending invitation",
      description:
        "Deletes a pending invitation so its link stops working. Requires the `invite_members` " +
        "permission. An already accepted or unknown invitation answers 404.",
      scope: "invites:write",
      audience: "team",
      responses: {
        200: jsonResponse({ description: "The invitation was revoked.", schema: successSchema }),
      },
    }),
    apiValidator("param", revokeTeamInvitationSchema),
    async (c) => {
      const { teamId, invitationId } = c.req.valid("param");

      return c.json(await revokeTeamInvitation({ teamId, invitationId }));
    },
  );
