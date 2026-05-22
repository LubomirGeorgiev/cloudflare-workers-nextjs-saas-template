"use server";

import { z } from "zod";
import { createTeam, getUserTeams } from "@/lib/teams/teams";
import { actionClient } from "@/lib/safe-action";
import { runVerifiedAction } from "@/lib/verified-action";

const createTeamSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  description: z.string().max(1000, "Description is too long").optional(),
});

export const createTeamAction = actionClient
  .inputSchema(createTeamSchema)
  .action(async ({ parsedInput: input }) => {
    return runVerifiedAction({
      actionName: "Failed to create team",
      failureMessage: "Failed to create team",
      handler: () => createTeam(input),
    });
  });

/**
 * Get all teams for the current user
 */
export const getUserTeamsAction = actionClient
  .action(async () => {
    return runVerifiedAction({
      actionName: "Failed to get user teams",
      failureMessage: "Failed to get user teams",
      handler: getUserTeams,
    });
  });
