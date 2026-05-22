"use server";

import { actionClient } from "@/lib/safe-action";
import { runVerifiedAction } from "@/lib/verified-action";
import { z } from "zod";
import {
  acceptTeamInvitation,
  inviteUserToTeam,
  removeTeamMember,
  getPendingInvitationsForCurrentUser
} from "@/lib/teams/team-members";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";

// Invite user schema
const inviteUserSchema = z.object({
  teamId: z.string().min(1, "Team ID is required"),
  email: z.string().email("Invalid email").max(255, "Email is too long"),
  roleId: z.string().min(1, "Role is required"),
  isSystemRole: z.boolean().optional().default(true),
});

const removeMemberSchema = z.object({
  teamId: z.string().min(1, "Team ID is required"),
  userId: z.string().min(1, "User ID is required"),
});

const invitationTokenSchema = z.object({
  token: z.string().min(1, "Invitation token is required"),
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
