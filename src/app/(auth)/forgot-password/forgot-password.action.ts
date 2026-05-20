"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { sendPasswordResetEmail } from "@/utils/email";
import { init } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import { getResetTokenKey } from "@/utils/auth-utils";
import { validateTurnstileToken } from "@/utils/validate-captcha";
import { forgotPasswordSchema } from "@/schemas/forgot-password.schema";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { PASSWORD_RESET_TOKEN_EXPIRATION_SECONDS } from "@/constants";
import { isTurnstileEnabled } from "@/flags";

const createId = init({
  length: 32,
});

export const forgotPasswordAction = actionClient
  .inputSchema(forgotPasswordSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        if (await isTurnstileEnabled() && input.captchaToken) {
          const success = await validateTurnstileToken(input.captchaToken)

          if (!success) {
            throw new ActionError(
              "INPUT_PARSE_ERROR",
              "Please complete the captcha"
            )
          }
        }

        const db = getDB();
        const { env } = await getCloudflareContext();

        try {
          // Find user by email
          const user = await db.query.userTable.findFirst({
            where: eq(userTable.email, input.email.toLowerCase()),
          });

          // Even if user is not found, return success to prevent email enumeration
          if (!user) {
            return { success: true };
          }

          // Generate reset token
          const token = createId();
          const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_EXPIRATION_SECONDS * 1000);

          if (!env?.NEXT_INC_CACHE_KV) {
            throw new Error("Can't connect to KV store");
          }

          // Save reset token in KV with expiration
          await env.NEXT_INC_CACHE_KV.put(
            getResetTokenKey(token),
            JSON.stringify({
              userId: user.id,
              expiresAt: expiresAt.toISOString(),
            }),
            {
              expirationTtl: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
            }
          );

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
