"use server";

import { z } from "zod";
import { createTeam, deleteTeam, getTeam, getUserTeams, updateTeam } from "@/lib/teams/teams";
import { ZSAError, createServerAction } from "zsa";

// Update team schema
const updateTeamSchema = z.object({
  teamId: z.string().min(1, "Team ID is required"),
  data: z.object({
    name: z.string().min(1, "Name is required").max(100, "Name is too long").optional(),
    description: z.string().max(1000, "Description is too long").optional(),
    avatarUrl: z.string().url("Invalid avatar URL").max(600, "URL is too long").optional(),
    billingEmail: z.string().email("Invalid email").max(255, "Email is too long").optional(),
    settings: z.string().max(10000, "Settings are too large").optional(),
  }),
});

const deleteTeamSchema = z.object({
  teamId: z.string().min(1, "Team ID is required"),
});

const getTeamSchema = z.object({
  teamId: z.string().min(1, "Team ID is required"),
});

const createTeamSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  description: z.string().max(1000, "Description is too long").optional(),
});

export const createTeamAction = createServerAction()
  .input(createTeamSchema)
  .handler(async ({ input }) => {
    try {
      const result = await createTeam(input);
      return { success: true, data: result };
    } catch (error) {
      console.error("Failed to create team:", error);

      if (error instanceof ZSAError) {
        throw error;
      }

      throw new ZSAError(
        "INTERNAL_SERVER_ERROR",
        "Failed to create team"
      );
    }
  });

/**
 * Update team details server action
 */
export const updateTeamAction = createServerAction()
  .input(updateTeamSchema)
  .handler(async ({ input }) => {
    try {
      const result = await updateTeam(input);
      return { success: true, data: result };
    } catch (error) {
      console.error("Failed to update team:", error);

      if (error instanceof ZSAError) {
        throw error;
      }

      throw new ZSAError(
        "INTERNAL_SERVER_ERROR",
        "Failed to update team"
      );
    }
  });

/**
 * Delete team server action
 */
export const deleteTeamAction = createServerAction()
  .input(deleteTeamSchema)
  .handler(async ({ input }) => {
    try {
      await deleteTeam(input.teamId);
      return { success: true };
    } catch (error) {
      console.error("Failed to delete team:", error);

      if (error instanceof ZSAError) {
        throw error;
      }

      throw new ZSAError(
        "INTERNAL_SERVER_ERROR",
        "Failed to delete team"
      );
    }
  });

/**
 * Get all teams for the current user
 */
export const getUserTeamsAction = createServerAction()
  .handler(async () => {
    try {
      const teams = await getUserTeams();
      return { success: true, data: teams };
    } catch (error) {
      console.error("Failed to get user teams:", error);

      if (error instanceof ZSAError) {
        throw error;
      }

      throw new ZSAError(
        "INTERNAL_SERVER_ERROR",
        "Failed to get user teams"
      );
    }
  });

/**
 * Get a team by ID
 */
export const getTeamAction = createServerAction()
  .input(getTeamSchema)
  .handler(async ({ input }) => {
    try {
      const team = await getTeam(input.teamId);
      return { success: true, data: team };
    } catch (error) {
      console.error(`Failed to get team ${input.teamId}:`, error);

      if (error instanceof ZSAError) {
        throw error;
      }

      throw new ZSAError(
        "INTERNAL_SERVER_ERROR",
        "Failed to get team"
      );
    }
  });
