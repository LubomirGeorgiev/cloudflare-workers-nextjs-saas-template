"use server";

import { z } from "zod";
import { createTeamRole, deleteTeamRole, getTeamRoles, updateTeamRole } from "@/lib/teams/team-roles";
import { ZSAError, createServerAction } from "zsa";

// Create role schema
const createRoleSchema = z.object({
  teamId: z.string().min(1, "Team ID is required"),
  name: z.string().min(1, "Name is required").max(255, "Name is too long"),
  description: z.string().max(1000, "Description is too long").optional(),
  permissions: z.array(z.string()).min(1, "At least one permission is required"),
  metadata: z.record(z.unknown()).optional(),
});

// Update role schema
const updateRoleSchema = z.object({
  teamId: z.string().min(1, "Team ID is required"),
  roleId: z.string().min(1, "Role ID is required"),
  data: z.object({
    name: z.string().min(1, "Name is required").max(255, "Name is too long").optional(),
    description: z.string().max(1000, "Description is too long").optional(),
    permissions: z.array(z.string()).min(1, "At least one permission is required").optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
});

const teamIdSchema = z.object({
  teamId: z.string().min(1, "Team ID is required"),
});

const deleteRoleSchema = z.object({
  teamId: z.string().min(1, "Team ID is required"),
  roleId: z.string().min(1, "Role ID is required"),
});

/**
 * Get all roles for a team
 */
export const getTeamRolesAction = createServerAction()
  .input(teamIdSchema)
  .handler(async ({ input }) => {
    try {
      const roles = await getTeamRoles(input.teamId);
      return { success: true, data: roles };
    } catch (error) {
      console.error("Failed to get team roles:", error);

      if (error instanceof ZSAError) {
        throw error;
      }

      throw new ZSAError(
        "INTERNAL_SERVER_ERROR",
        "Failed to get team roles"
      );
    }
  });

/**
 * Create a new role for a team
 */
export const createRoleAction = createServerAction()
  .input(createRoleSchema)
  .handler(async ({ input }) => {
    try {
      const result = await createTeamRole(input);
      return { success: true, data: result };
    } catch (error) {
      console.error("Failed to create role:", error);

      if (error instanceof ZSAError) {
        throw error;
      }

      throw new ZSAError(
        "INTERNAL_SERVER_ERROR",
        "Failed to create role"
      );
    }
  });

/**
 * Update an existing team role
 */
export const updateRoleAction = createServerAction()
  .input(updateRoleSchema)
  .handler(async ({ input }) => {
    try {
      const result = await updateTeamRole(input);
      return { success: true, data: result };
    } catch (error) {
      console.error("Failed to update role:", error);

      if (error instanceof ZSAError) {
        throw error;
      }

      throw new ZSAError(
        "INTERNAL_SERVER_ERROR",
        "Failed to update role"
      );
    }
  });

/**
 * Delete a team role
 */
export const deleteRoleAction = createServerAction()
  .input(deleteRoleSchema)
  .handler(async ({ input }) => {
    try {
      await deleteTeamRole(input);
      return { success: true };
    } catch (error) {
      console.error("Failed to delete role:", error);

      if (error instanceof ZSAError) {
        throw error;
      }

      throw new ZSAError(
        "INTERNAL_SERVER_ERROR",
        "Failed to delete role"
      );
    }
  });
