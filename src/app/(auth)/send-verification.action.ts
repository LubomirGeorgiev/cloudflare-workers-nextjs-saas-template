"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { getSessionFromCookie } from "@/utils/auth";
import { sendUserVerificationEmail } from "@/utils/email-verification";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { z } from "zod";

export const sendVerificationAction = actionClient
  .inputSchema(z.void())
  .action(async () => {
    return withRateLimit(
      async () => {
        const session = await getSessionFromCookie();

        if (!session) {
          throw new ActionError(
            "NOT_AUTHORIZED",
            "Not authenticated"
          );
        }

        if (session?.user?.emailVerified) {
          throw new ActionError(
            "PRECONDITION_FAILED",
            "Email is already verified"
          );
        }

        await sendUserVerificationEmail({
          userId: session.user.id,
          email: session.user.email!,
          username: session.user.firstName || session.user.email!,
        });

        return { success: true };
      },
      RATE_LIMITS.EMAIL
    );
  });
