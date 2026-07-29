"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { getSessionFromCookie } from "@/utils/auth";
import { updateKVSessionSelectedTeam } from "@/utils/kv-session";
import { getActiveTeamMembership } from "@/utils/team-membership";
import { updateSelectedTeamSchema } from "@/schemas/session.schema";

export const updateSelectedTeamAction = actionClient
  .inputSchema(updateSelectedTeamSchema)
  .action(async ({ parsedInput: input }) => {
    try {
      const session = await getSessionFromCookie();

      if (!session) {
        throw new ActionError("FORBIDDEN", {
          key: "Client.Dashboard.Teams.errorMustBeLoggedIn",
        });
      }

      // Validate the selection against a current, active D1 membership rather than the stale
      // KV `session.teams` snapshot, so revoked/expired memberships can't be reselected.
      if (input.selectedTeam) {
        const membership = await getActiveTeamMembership({
          teamId: input.selectedTeam,
          userId: session.userId,
        });

        if (!membership) {
          throw new ActionError("FORBIDDEN", {
            key: "Client.Dashboard.Teams.errorTeamNotFoundOrNotMember",
          });
        }
      }

      const updatedSession = await updateKVSessionSelectedTeam(
        session.id,
        session.userId,
        input.selectedTeam
      );

      if (!updatedSession) {
        throw new ActionError("INTERNAL_SERVER_ERROR", {
          key: "Client.Dashboard.Teams.errorUpdateSelectedTeam",
        });
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

      throw new ActionError("INTERNAL_SERVER_ERROR", {
        key: "Client.Dashboard.Teams.errorUpdateSelectedTeam",
      });
    }
  });
