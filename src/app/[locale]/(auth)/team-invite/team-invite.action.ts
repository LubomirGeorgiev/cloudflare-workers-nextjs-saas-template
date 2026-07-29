"use server";

import "server-only";
import { teamInviteSchema } from "@/schemas/team-membership.schema";
import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { acceptTeamInvitationByToken } from "@/lib/teams/team-invitation-accept";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";

export const acceptTeamInviteAction = actionClient
  .inputSchema(teamInviteSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        // Every accept path requires a verified email; the core (acceptTeamInvitationByToken)
        // re-checks and throws without one, so no separate guard is needed here.
        try {
          const result = await acceptTeamInvitationByToken(input.token);
          return result;
        } catch (error) {
          console.error("Error accepting team invitation:", error);

          if (error instanceof ActionError) {
            throw error;
          }

          throw new ActionError("INTERNAL_SERVER_ERROR", {
            key: "Client.Auth.TeamInvite.errorUnexpected",
          });
        }
      },
      // Acceptance sends no email; SETTINGS is the correct mutation bucket (EMAIL is for
      // email-dispatch paths).
      RATE_LIMITS.SETTINGS
    );
  });
