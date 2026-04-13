"use server";

import { z } from "zod";
import { createTeam, getUserTeams } from "@/lib/teams/teams";
import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { requireVerifiedEmail } from "@/utils/auth";

const createTeamSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  description: z.string().max(1000, "Description is too long").optional(),
});

export const createTeamAction = actionClient
  .inputSchema(createTeamSchema)
  .action(async ({ parsedInput: input }) => {
    const session = await requireVerifiedEmail();

    if (!session) {
      throw new ActionError("NOT_AUTHORIZED", "Not authenticated");
    }

    try {
      const result = await createTeam(input);
      return { success: true, data: result };
    } catch (error) {
      console.error("Failed to create team:", error);

      if (error instanceof ActionError) {
        throw error;
      }

      throw new ActionError(
        "INTERNAL_SERVER_ERROR",
        "Failed to create team"
      );
    }
  });

/**
 * Get all teams for the current user
 */
export const getUserTeamsAction = actionClient
  .action(async () => {
    const session = await requireVerifiedEmail();

    if (!session) {
      throw new ActionError("NOT_AUTHORIZED", "Not authenticated");
    }

    try {
      const teams = await getUserTeams();
      return { success: true, data: teams };
    } catch (error) {
      console.error("Failed to get user teams:", error);

      if (error instanceof ActionError) {
        throw error;
      }

      throw new ActionError(
        "INTERNAL_SERVER_ERROR",
        "Failed to get user teams"
      );
    }
  });
