"use server";

import "server-only";
import { getTranslations } from "next-intl/server";
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
        const t = await getTranslations("Client.Auth.TeamInvite");
        const session = await getSessionFromCookie();

        if (!session) {
          throw new ActionError(
            "NOT_AUTHORIZED",
            t("errorMustBeLoggedIn")
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
            t("errorUnexpected")
          );
        }
      },
      RATE_LIMITS.EMAIL
    );
  });
