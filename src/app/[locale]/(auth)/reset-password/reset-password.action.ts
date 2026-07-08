"use server";

import { getTranslations } from "next-intl/server";
import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { resetPasswordSchema } from "@/schemas/reset-password.schema";
import { hashPassword } from "@/utils/password-hasher";
import { eq } from "drizzle-orm";
import { getResetTokenKey } from "@/utils/auth-utils";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { deleteExpiringToken, getValidExpiringToken } from "@/utils/kv-token";

export const resetPasswordAction = actionClient
  .inputSchema(resetPasswordSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        const t = await getTranslations("Client.Auth.ResetPassword");
        const tErrors = await getTranslations("Client.Errors");
        const db = getDB();

        try {
          const resetToken = await getValidExpiringToken({
            token: input.token,
            key: getResetTokenKey,
            notFoundError: {
              code: "NOT_FOUND",
              message: t("errorInvalidToken"),
            },
            expiredError: {
              code: "PRECONDITION_FAILED",
              message: t("errorTokenExpired"),
            },
          });

          // Find user
          const user = await db.query.userTable.findFirst({
            where: { id: resetToken.userId },
          });

          if (!user) {
            throw new ActionError(
              "NOT_FOUND",
              tErrors("userNotFound")
            );
          }

          // Update password
          const passwordHash = await hashPassword({ password: input.password });
          await db.update(userTable)
            .set({ passwordHash })
            .where(eq(userTable.id, resetToken.userId));

          // Delete the used token
          await deleteExpiringToken({
            token: input.token,
            key: getResetTokenKey,
          });

          return { success: true };
        } catch (error) {
          console.error(error)

          if (error instanceof ActionError) {
            throw error;
          }

          throw new ActionError(
            "INTERNAL_SERVER_ERROR",
            tErrors("unexpected")
          );
        }
      },
      RATE_LIMITS.RESET_PASSWORD
    );
  });
