"use server";

import { actionClient } from "@/lib/safe-action";
import { runVerifiedAction } from "@/lib/verified-action";
import {
  removeTeamMember,
  getPendingInvitationsForCurrentUser
} from "@/lib/teams/team-members";
import { inviteUserToTeam } from "@/lib/teams/team-invite";
import { acceptTeamInvitationById } from "@/lib/teams/team-invitation-accept";
import { revokeTeamInvitation } from "@/lib/teams/team-invitation-revoke";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { invitationIdSchema, inviteUserSchema, removeMemberSchema, revokeTeamInvitationSchema } from "@/schemas/team-membership.schema";

export const inviteUserAction = actionClient
  .inputSchema(inviteUserSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        return runVerifiedAction({
          actionName: "Failed to invite user",
          failureMessageKey: "Client.Dashboard.Teams.toastInviteError",
          handler: () => inviteUserToTeam(input),
        });
      },
      RATE_LIMITS.TEAM_INVITE
    );
  });

export const removeTeamMemberAction = actionClient
  .inputSchema(removeMemberSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        return runVerifiedAction({
          actionName: "Failed to remove team member",
          failureMessageKey: "Client.Dashboard.Teams.toastRemoveError",
          handler: () => removeTeamMember(input),
        });
      },
      RATE_LIMITS.SETTINGS
    );
  });

export const revokeTeamInvitationAction = actionClient
  .inputSchema(revokeTeamInvitationSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        return runVerifiedAction({
          actionName: "Failed to revoke team invitation",
          failureMessageKey: "Client.Dashboard.Teams.toastRevokeInvitationError",
          handler: () => revokeTeamInvitation(input),
        });
      },
      RATE_LIMITS.SETTINGS
    );
  });

export const acceptInvitationAction = actionClient
  .inputSchema(invitationIdSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        return runVerifiedAction({
          actionName: "Failed to accept invitation",
          failureMessageKey: "Client.Dashboard.Teams.errorAcceptInvitation",
          handler: () => acceptTeamInvitationById(input.invitationId),
        });
      },
      // Acceptance sends no email; SETTINGS is the correct mutation bucket (matches member removal).
      RATE_LIMITS.SETTINGS
    );
  });

export const getPendingInvitationsForCurrentUserAction = actionClient
  .action(async () => {
    return runVerifiedAction({
      actionName: "Failed to get pending team invitations",
      failureMessageKey: "Client.Dashboard.Teams.errorGetPendingInvitations",
      handler: getPendingInvitationsForCurrentUser,
    });
  });
