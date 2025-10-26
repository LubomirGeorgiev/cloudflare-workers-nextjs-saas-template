"use server";

import "server-only";
import { teamInviteSchema } from "@/schemas/team-invite.schema";
import { createServerAction, ZSAError } from "zsa";
import { acceptTeamInvitation } from "@/lib/teams/team-members";
import { getSessionFromCookie } from "@/utils/auth";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";

export const acceptTeamInviteAction = createServerAction()
  .input(teamInviteSchema)
  .handler(async ({ input }) => {
    return withRateLimit(
      async () => {
        // Check if user is logged in
        const session = await getSessionFromCookie();

        if (!session) {
          throw new ZSAError(
            "NOT_AUTHORIZED",
            "You must be logged in to accept an invitation"
          );
        }

        try {
          const result = await acceptTeamInvitation(input.token);
          return result;
        } catch (error) {
          console.error("Error accepting team invitation:", error);

          if (error instanceof ZSAError) {
            throw error;
          }

          throw new ZSAError(
            "INTERNAL_SERVER_ERROR",
            "An unexpected error occurred while accepting the invitation"
          );
        }
      },
      RATE_LIMITS.EMAIL
    );
  });
