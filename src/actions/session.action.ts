"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { getSessionFromCookie } from "@/utils/auth";
import { updateKVSessionSelectedTeam } from "@/utils/kv-session";
import { v } from "@/lib/validation";

const updateSelectedTeamSchema = v.object({
  selectedTeam: v.optional(v.string()),
});

export const updateSelectedTeamAction = actionClient
  .inputSchema(updateSelectedTeamSchema)
  .action(async ({ parsedInput: input }) => {
    try {
      const session = await getSessionFromCookie();

      if (!session) {
        throw new ActionError(
          "FORBIDDEN",
          "You must be logged in to update your selected team"
        );
      }

      if (input.selectedTeam && session.teams) {
        const teamExists = session.teams.some(team => team.id === input.selectedTeam);
        if (!teamExists) {
          throw new ActionError(
            "FORBIDDEN",
            "Team not found or you are not a member"
          );
        }
      }

      const updatedSession = await updateKVSessionSelectedTeam(
        session.id,
        session.userId,
        input.selectedTeam
      );

      if (!updatedSession) {
        throw new ActionError(
          "INTERNAL_SERVER_ERROR",
          "Failed to update selected team"
        );
      }

      return {
        success: true,
        selectedTeam: updatedSession.selectedTeam
      };
    } catch (error) {
      console.error("Failed to update selected team:", error);

      if (error instanceof ActionError) {
        throw error;
      }

      throw new ActionError(
        "INTERNAL_SERVER_ERROR",
        "Failed to update selected team"
      );
    }
  });
