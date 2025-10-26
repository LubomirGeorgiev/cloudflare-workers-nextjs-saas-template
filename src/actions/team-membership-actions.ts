"use server";

import { createServerAction, ZSAError } from "zsa";
import { z } from "zod";
import { acceptTeamInvitation, cancelTeamInvitation, getTeamInvitations, getTeamMembers, inviteUserToTeam, removeTeamMember, updateTeamMemberRole, getPendingInvitationsForCurrentUser } from "@/lib/teams/team-members";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";

// Invite user schema
const inviteUserSchema = z.object({
  teamId: z.string().min(1, "Team ID is required"),
  email: z.string().email("Invalid email").max(255, "Email is too long"),
  roleId: z.string().min(1, "Role is required"),
  isSystemRole: z.boolean().optional().default(true),
});

// Update member role schema
const updateMemberRoleSchema = z.object({
  teamId: z.string().min(1, "Team ID is required"),
  userId: z.string().min(1, "User ID is required"),
  roleId: z.string().min(1, "Role is required"),
  isSystemRole: z.boolean().optional().default(true),
});

const teamIdSchema = z.object({
  teamId: z.string().min(1, "Team ID is required"),
});

const removeMemberSchema = z.object({
  teamId: z.string().min(1, "Team ID is required"),
  userId: z.string().min(1, "User ID is required"),
});

const invitationIdSchema = z.object({
  invitationId: z.string().min(1, "Invitation ID is required"),
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
 * Get team members action
 */
export const getTeamMembersAction = createServerAction()
  .input(teamIdSchema)
  .handler(async ({ input }) => {
    try {
      const members = await getTeamMembers(input.teamId);
      return { success: true, data: members };
    } catch (error) {
      console.error("Failed to get team members:", error);

      if (error instanceof ZSAError) {
        throw error;
      }

      throw new ZSAError(
        "INTERNAL_SERVER_ERROR",
        "Failed to get team members"
      );
    }
  });

/**
 * Update a team member's role
 */
export const updateMemberRoleAction = createServerAction()
  .input(updateMemberRoleSchema)
  .handler(async ({ input }) => {
    try {
      await updateTeamMemberRole(input);
      return { success: true };
    } catch (error) {
      console.error("Failed to update member role:", error);

      if (error instanceof ZSAError) {
        throw error;
      }

      throw new ZSAError(
        "INTERNAL_SERVER_ERROR",
        "Failed to update member role"
      );
    }
  });

/**
 * Remove a team member
 */
export const removeTeamMemberAction = createServerAction()
  .input(removeMemberSchema)
  .handler(async ({ input }) => {
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
 * Get pending team invitations
 */
export const getTeamInvitationsAction = createServerAction()
  .input(teamIdSchema)
  .handler(async ({ input }) => {
    try {
      const invitations = await getTeamInvitations(input.teamId);
      return { success: true, data: invitations };
    } catch (error) {
      console.error("Failed to get team invitations:", error);

      if (error instanceof ZSAError) {
        throw error;
      }

      throw new ZSAError(
        "INTERNAL_SERVER_ERROR",
        "Failed to get team invitations"
      );
    }
  });

/**
 * Cancel a team invitation
 */
export const cancelInvitationAction = createServerAction()
  .input(invitationIdSchema)
  .handler(async ({ input }) => {
    try {
      await cancelTeamInvitation(input.invitationId);
      return { success: true };
    } catch (error) {
      console.error("Failed to cancel invitation:", error);

      if (error instanceof ZSAError) {
        throw error;
      }

      throw new ZSAError(
        "INTERNAL_SERVER_ERROR",
        "Failed to cancel invitation"
      );
    }
  });

/**
 * Accept a team invitation
 */
export const acceptInvitationAction = createServerAction()
  .input(invitationTokenSchema)
  .handler(async ({ input }) => {
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
