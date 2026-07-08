"use server";

import { getTranslations } from "next-intl/server";
import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { getSessionFromCookie } from "@/utils/auth";
import { sendUserVerificationEmail } from "@/utils/email-verification";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { v } from "@/lib/validation";

export const sendVerificationAction = actionClient
  .inputSchema(v.void())
  .action(async () => {
    return withRateLimit(
      async () => {
        const t = await getTranslations("Client.Auth.Common");
        const tErrors = await getTranslations("Client.Errors");
        const session = await getSessionFromCookie();

        if (!session) {
          throw new ActionError(
            "NOT_AUTHORIZED",
            tErrors("notAuthenticated")
          );
        }

        if (session?.user?.emailVerified) {
          throw new ActionError(
            "PRECONDITION_FAILED",
            t("errorEmailAlreadyVerified")
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
