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
import { emailString, requiredString, v } from "@/lib/validation";

// Invite user schema
const inviteUserSchema = v.object({
  teamId: requiredString("Team ID is required"),
  email: v.pipe(emailString("Invalid email"), v.maxLength(255, "Email is too long")),
  roleId: requiredString("Role is required"),
  isSystemRole: v.optional(v.boolean(), true),
});

const removeMemberSchema = v.object({
  teamId: requiredString("Team ID is required"),
  userId: requiredString("User ID is required"),
});

const invitationTokenSchema = v.object({
  token: requiredString("Invitation token is required"),
});

/**
 * Invite a user to a team
 */
export const inviteUserAction = actionClient
  .inputSchema(inviteUserSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        return runVerifiedAction({
          actionName: "Failed to invite user",
          failureMessage: "Failed to invite user",
          handler: () => inviteUserToTeam(input),
        });
      },
      RATE_LIMITS.TEAM_INVITE
    );
  });

/**
 * Remove a team member
 */
export const removeTeamMemberAction = actionClient
  .inputSchema(removeMemberSchema)
  .action(async ({ parsedInput: input }) => {
    return runVerifiedAction({
      actionName: "Failed to remove team member",
      failureMessage: "Failed to remove team member",
      handler: () => removeTeamMember(input),
    });
  });

/**
 * Accept a team invitation
 */
export const acceptInvitationAction = actionClient
  .inputSchema(invitationTokenSchema)
  .action(async ({ parsedInput: input }) => {
    return runVerifiedAction({
      actionName: "Failed to accept invitation",
      failureMessage: "Failed to accept invitation",
      handler: () => acceptTeamInvitation(input.token),
    });
  });

/**
 * Get pending team invitations for the current user
 */
export const getPendingInvitationsForCurrentUserAction = actionClient
  .action(async () => {
    return runVerifiedAction({
      actionName: "Failed to get pending team invitations",
      failureMessage: "Failed to get pending team invitations",
      handler: getPendingInvitationsForCurrentUser,
    });
  });
