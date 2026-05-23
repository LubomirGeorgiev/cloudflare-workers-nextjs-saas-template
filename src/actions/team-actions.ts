"use server";

import { createTeam, getUserTeams } from "@/lib/teams/teams";
import { actionClient } from "@/lib/safe-action";
import { runVerifiedAction } from "@/lib/verified-action";
import { maxString, requiredString, v } from "@/lib/validation";

const createTeamSchema = v.object({
  name: v.pipe(requiredString("Name is required"), v.maxLength(100, "Name is too long")),
  description: v.optional(maxString(1000, "Description is too long")),
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
