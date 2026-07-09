"use server";

import { createTeam, getUserTeams } from "@/lib/teams/teams";
import { actionClient } from "@/lib/safe-action";
import { runVerifiedAction } from "@/lib/verified-action";
import { encodeValidationMessage, maxString, requiredString, v, validationKey } from "@/lib/validation";

const createTeamSchema = v.object({
  name: v.pipe(
    requiredString(validationKey("nameRequired")),
    v.maxLength(100, encodeValidationMessage("nameMaxLength", { max: 100 }))
  ),
  description: v.optional(maxString(1000, encodeValidationMessage("descriptionMaxLength", { max: 1000 }))),
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

export const getUserTeamsAction = actionClient
  .action(async () => {
    return runVerifiedAction({
      actionName: "Failed to get user teams",
      failureMessage: "Failed to get user teams",
      handler: getUserTeams,
    });
  });
