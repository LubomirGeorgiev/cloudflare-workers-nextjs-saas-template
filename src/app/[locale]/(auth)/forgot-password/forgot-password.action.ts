"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { getDB } from "@/db";
import { userByEmailWhere } from "@/lib/auth/user-email";
import { sendPasswordResetEmail } from "@/utils/email";
import { validateTurnstileToken } from "@/utils/validate-captcha";
import { forgotPasswordSchema } from "@/schemas/forgot-password.schema";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { isTurnstileEnabled } from "@/flags";
import { createPasswordResetToken } from "@/utils/password-reset-token";
import { getUserLocale } from "@/i18n/locale";
import { isBanned } from "@/lib/account/ban";

export const forgotPasswordAction = actionClient
  .metadata({ actionName: "forgotPasswordAction" })
  .inputSchema(forgotPasswordSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        if (await isTurnstileEnabled()) {
          if (!input.captchaToken) {
            throw new ActionError("INPUT_PARSE_ERROR", { key: "Client.Auth.Common.errorCaptcha" })
          }

          const success = await validateTurnstileToken(input.captchaToken)

          if (!success) {
            throw new ActionError("INPUT_PARSE_ERROR", { key: "Client.Auth.Common.errorCaptcha" })
          }
        }

        const db = getDB();

        try {
          // Find user by email
          const user = await db.query.userTable.findFirst({
            where: userByEmailWhere(input.email),
          });

          // Even if user is not found, return success to prevent email enumeration. A banned
          // account takes the same branch: it gets no reset link, and the response must not tell
          // the caller which of the two happened.
          if (!user || isBanned(user)) {
            return { success: true };
          }

          const token = await createPasswordResetToken(user.id);

          // Send reset email
          if (user?.email) {
            // forgot-password is always self-service, so the requester is the
            // target user: getUserLocale() (cookie -> preferredLocale ->
            // Accept-Language -> default) is the right locale for their email.
            const locale = await getUserLocale();

            await sendPasswordResetEmail({
              email: user.email,
              resetToken: token,
              username: user.firstName ?? user.email,
              locale,
            });
          }

          return { success: true };
        } catch (error) {
          console.error(error)

          if (error instanceof ActionError) {
            throw error;
          }

          throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Errors.unexpected" });
        }
      },
      RATE_LIMITS.FORGOT_PASSWORD
    );
  });
