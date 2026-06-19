"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { getDB } from "@/db";
import { sendPasswordResetEmail } from "@/utils/email";
import { init } from "@paralleldrive/cuid2";
import { getResetTokenKey } from "@/utils/auth-utils";
import { validateTurnstileToken } from "@/utils/validate-captcha";
import { forgotPasswordSchema } from "@/schemas/forgot-password.schema";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { PASSWORD_RESET_TOKEN_EXPIRATION_SECONDS } from "@/constants";
import { isTurnstileEnabled } from "@/flags";
import { createExpiringToken } from "@/utils/kv-token";

const createId = init({
  length: 32,
});

export const forgotPasswordAction = actionClient
  .inputSchema(forgotPasswordSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        if (await isTurnstileEnabled()) {
          if (!input.captchaToken) {
            throw new ActionError(
              "INPUT_PARSE_ERROR",
              "Please complete the captcha"
            )
          }

          const success = await validateTurnstileToken(input.captchaToken)

          if (!success) {
            throw new ActionError(
              "INPUT_PARSE_ERROR",
              "Please complete the captcha"
            )
          }
        }

        const db = getDB();

        try {
          // Find user by email
          const user = await db.query.userTable.findFirst({
            where: { email: input.email.toLowerCase() },
          });

          // Even if user is not found, return success to prevent email enumeration
          if (!user) {
            return { success: true };
          }

          const token = await createExpiringToken({
            key: getResetTokenKey,
            expiresInSeconds: PASSWORD_RESET_TOKEN_EXPIRATION_SECONDS,
            payload: {
              userId: user.id,
            },
            createToken: createId,
          });

          // Send reset email
          if (user?.email) {
            await sendPasswordResetEmail({
              email: user.email,
              resetToken: token,
              username: user.firstName ?? user.email,
            });
          }

          return { success: true };
        } catch (error) {
          console.error(error)

          if (error instanceof ActionError) {
            throw error;
          }

          throw new ActionError(
            "INTERNAL_SERVER_ERROR",
            "An unexpected error occurred"
          );
        }
      },
      RATE_LIMITS.FORGOT_PASSWORD
    );
  });
