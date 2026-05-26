"use server";

import "server-only";
import { getVerificationTokenKey } from "@/utils/auth-utils";
import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { updateAllSessionsOfUser } from "@/utils/kv-session";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { verifyEmailSchema } from "@/schemas/verify-email.schema";
import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { deleteExpiringToken, getValidExpiringToken } from "@/utils/kv-token";

export const verifyEmailAction = actionClient
  .inputSchema(verifyEmailSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        const verificationToken = await getValidExpiringToken({
          token: input.token,
          key: getVerificationTokenKey,
          notFoundError: {
            code: "NOT_FOUND",
            message: "Verification token not found or expired",
          },
        });

        const db = getDB();

        // Find user
        const user = await db.query.userTable.findFirst({
          where: eq(userTable.id, verificationToken.userId),
        });

        if (!user) {
          throw new ActionError(
            "NOT_FOUND",
            "User not found"
          );
        }

        try {
          // Update user's email verification status
          await db.update(userTable)
            .set({ emailVerified: new Date() })
            .where(eq(userTable.id, verificationToken.userId));

          // Update all sessions of the user to reflect the new email verification status
          await updateAllSessionsOfUser(verificationToken.userId);

          // Delete the used token
          await deleteExpiringToken({
            token: input.token,
            key: getVerificationTokenKey,
          });

          return { success: true };
        } catch (error) {
          console.error(error);

          throw new ActionError(
            "INTERNAL_SERVER_ERROR",
            "An unexpected error occurred"
          );
        }
      },
      RATE_LIMITS.EMAIL
    );
  });
