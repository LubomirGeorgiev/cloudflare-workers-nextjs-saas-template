"use server";

import { createServerAction, ZSAError } from "zsa";
import { z } from "zod";
import {
  acceptTeamInvitation,
  inviteUserToTeam,
  removeTeamMember,
  getPendingInvitationsForCurrentUser
} from "@/lib/teams/team-members";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { requireVerifiedEmail } from "@/utils/auth";

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
export const inviteUserAction = createServerAction()
  .input(inviteUserSchema)
  .handler(async ({ input }) => {
    return withRateLimit(
      async () => {
        const session = await requireVerifiedEmail();

        if (!session) {
          throw new ZSAError("NOT_AUTHORIZED", "Not authenticated");
        }

        try {
          const result = await inviteUserToTeam(input);
          return { success: true, data: result };
        } catch (error) {
          console.error("Failed to invite user:", error);

          if (error instanceof ZSAError) {
            throw error;
          }

          throw new ZSAError(
            "INTERNAL_SERVER_ERROR",
            "Failed to invite user"
          );
        }
      },
      RATE_LIMITS.TEAM_INVITE
    );
  });

/**
 * Remove a team member
 */
export const removeTeamMemberAction = createServerAction()
  .input(removeMemberSchema)
  .handler(async ({ input }) => {
    const session = await requireVerifiedEmail();

    if (!session) {
      throw new ZSAError("NOT_AUTHORIZED", "Not authenticated");
    }

    try {
      await removeTeamMember(input);
      return { success: true };
    } catch (error) {
      console.error("Failed to remove team member:", error);

      if (error instanceof ZSAError) {
        throw error;
      }

      throw new ZSAError(
        "INTERNAL_SERVER_ERROR",
        "Failed to remove team member"
      );
    }
  });

/**
 * Accept a team invitation
 */
export const acceptInvitationAction = createServerAction()
  .input(invitationTokenSchema)
  .handler(async ({ input }) => {
    const session = await requireVerifiedEmail();

    if (!session) {
      throw new ZSAError("NOT_AUTHORIZED", "Not authenticated");
    }

    try {
      const result = await acceptTeamInvitation(input.token);
      return { success: true, data: result };
    } catch (error) {
      console.error("Failed to accept invitation:", error);

      if (error instanceof ZSAError) {
        throw error;
      }

      throw new ZSAError(
        "INTERNAL_SERVER_ERROR",
        "Failed to accept invitation"
      );
    }
  });

/**
 * Get pending team invitations for the current user
 */
export const getPendingInvitationsForCurrentUserAction = createServerAction()
  .handler(async () => {
    const session = await requireVerifiedEmail();

    if (!session) {
      throw new ZSAError("NOT_AUTHORIZED", "Not authenticated");
    }

    try {
      const invitations = await getPendingInvitationsForCurrentUser();
      return { success: true, data: invitations };
    } catch (error) {
      console.error("Failed to get pending team invitations:", error);

      if (error instanceof ZSAError) {
        throw error;
      }

      throw new ZSAError(
        "INTERNAL_SERVER_ERROR",
        "Failed to get pending team invitations"
      );
    }
  });
