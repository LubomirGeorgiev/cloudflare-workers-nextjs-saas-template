"use server";

import { actionClient } from "@/lib/safe-action";
import { runVerifiedAction } from "@/lib/verified-action";
import {
  acceptTeamInvitation,
  inviteUserToTeam,
  removeTeamMember,
  getPendingInvitationsForCurrentUser
} from "@/lib/teams/team-members";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { emailString, encodeValidationMessage, requiredString, v, validationKey } from "@/lib/validation";

// Invite user schema
const inviteUserSchema = v.object({
  teamId: requiredString(validationKey("teamIdRequired")),
  email: v.pipe(emailString(), v.maxLength(255, encodeValidationMessage("emailMaxLength", { max: 255 }))),
  roleId: requiredString(validationKey("roleRequired")),
  isSystemRole: v.optional(v.boolean(), true),
});

const removeMemberSchema = v.object({
  teamId: requiredString(validationKey("teamIdRequired")),
  userId: requiredString(validationKey("userIdRequired")),
});

const invitationTokenSchema = v.object({
  token: requiredString(validationKey("invitationTokenRequired")),
});

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
    return runVerifiedAction({
      actionName: "Failed to remove team member",
      failureMessageKey: "Client.Dashboard.Teams.toastRemoveError",
      handler: () => removeTeamMember(input),
    });
  });

export const acceptInvitationAction = actionClient
  .inputSchema(invitationTokenSchema)
  .action(async ({ parsedInput: input }) => {
    return runVerifiedAction({
      actionName: "Failed to accept invitation",
      failureMessageKey: "Client.Dashboard.Teams.errorAcceptInvitation",
      handler: () => acceptTeamInvitation(input.token),
    });
  });

export const getPendingInvitationsForCurrentUserAction = actionClient
  .action(async () => {
    return runVerifiedAction({
      actionName: "Failed to get pending team invitations",
      failureMessageKey: "Client.Dashboard.Teams.errorGetPendingInvitations",
      handler: getPendingInvitationsForCurrentUser,
    });
  });
