"use server";

import { revalidatePath } from "next/cache";

import { createTeam, getUserTeams, renameTeam } from "@/lib/teams/teams";
import { actionClient } from "@/lib/safe-action";
import { runVerifiedAction } from "@/lib/verified-action";
import { RATE_LIMITS } from "@/utils/with-rate-limit";
import { withUserRateLimit } from "@/utils/with-user-rate-limit";
import { createTeamSchema, renameTeamSchema } from "@/schemas/team.schema";

export const createTeamAction = actionClient
  .inputSchema(createTeamSchema)
  .action(async ({ parsedInput: input }) => {
    return runVerifiedAction({
      actionName: "Failed to create team",
      failureMessageKey: "Client.Dashboard.Teams.toastCreateError",
      handler: () => createTeam(input),
    });
  });

export const renameTeamAction = actionClient
  .inputSchema(renameTeamSchema)
  .action(async ({ parsedInput: input }) => {
    return withUserRateLimit(
      async () => {
        const result = await runVerifiedAction({
          actionName: "Failed to rename team",
          failureMessageKey: "Client.Dashboard.Teams.toastRenameError",
          handler: () => renameTeam(input),
        });

        // The name is rendered in the teams listing cards, and in the team page heading,
        // breadcrumb, and metadata.
        revalidatePath("/dashboard/teams");
        revalidatePath(`/dashboard/teams/${result.data.slug}`);

        return result;
      },
      RATE_LIMITS.SETTINGS
    );
  });

export const getUserTeamsAction = actionClient
  .action(async () => {
    return runVerifiedAction({
      actionName: "Failed to get user teams",
      failureMessageKey: "Client.Dashboard.Teams.errorGetTeams",
      handler: getUserTeams,
    });
  });
