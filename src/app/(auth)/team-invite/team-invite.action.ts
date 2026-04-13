"use server";

import "server-only";
import { teamInviteSchema } from "@/schemas/team-invite.schema";
import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { acceptTeamInvitation } from "@/lib/teams/team-members";
import { getSessionFromCookie } from "@/utils/auth";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";

export const acceptTeamInviteAction = actionClient
  .inputSchema(teamInviteSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        // Check if user is logged in
        const session = await getSessionFromCookie();

        if (!session) {
          throw new ActionError(
            "NOT_AUTHORIZED",
            "You must be logged in to accept an invitation"
          );
        }

        try {
          const result = await acceptTeamInvitation(input.token);
          return result;
        } catch (error) {
          console.error("Error accepting team invitation:", error);

          if (error instanceof ActionError) {
            throw error;
          }

          throw new ActionError(
            "INTERNAL_SERVER_ERROR",
            "An unexpected error occurred while accepting the invitation"
          );
        }
      },
      RATE_LIMITS.EMAIL
    );
  });
