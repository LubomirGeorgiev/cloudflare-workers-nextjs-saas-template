"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { resetPasswordSchema } from "@/schemas/reset-password.schema";
import { hashPassword } from "@/utils/password-hasher";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getResetTokenKey } from "@/utils/auth-utils";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";

export const resetPasswordAction = actionClient
  .inputSchema(resetPasswordSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        const db = getDB();
        const { env } = getCloudflareContext();

        if (!env?.NEXT_INC_CACHE_KV) {
          throw new Error("Can't connect to KV store");
        }

        try {
          // Find valid reset token
          const resetTokenStr = await env.NEXT_INC_CACHE_KV.get(getResetTokenKey(input.token));
          if (!resetTokenStr) {
            throw new ActionError(
              "NOT_FOUND",
              "Invalid or expired reset token"
            );
          }

          const resetToken = JSON.parse(resetTokenStr) as {
            userId: string;
            expiresAt: string;
          };

          // Check if token is expired (although KV should have auto-deleted it)
          if (new Date() > new Date(resetToken.expiresAt)) {
            throw new ActionError(
              "PRECONDITION_FAILED",
              "Reset token has expired"
            );
          }

          // Find user
          const user = await db.query.userTable.findFirst({
            where: eq(userTable.id, resetToken.userId),
          });

          if (!user) {
            throw new ActionError(
              "NOT_FOUND",
              "User not found"
            );
          }

          // Update password
          const passwordHash = await hashPassword({ password: input.password });
          await db.update(userTable)
            .set({ passwordHash })
            .where(eq(userTable.id, resetToken.userId));

          // Delete the used token
          await env.NEXT_INC_CACHE_KV.delete(getResetTokenKey(input.token));

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
      RATE_LIMITS.RESET_PASSWORD
    );
  });
