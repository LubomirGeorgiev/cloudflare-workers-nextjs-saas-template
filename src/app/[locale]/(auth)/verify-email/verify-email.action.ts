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
import { assertNotBanned } from "@/lib/account/ban";

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
            message: { key: "Client.Auth.VerifyEmail.errorTokenNotFound" },
          },
        });

        const db = getDB();

        // Find user
        const user = await db.query.userTable.findFirst({
          where: { id: verificationToken.userId },
        });

        if (!user) {
          throw new ActionError("NOT_FOUND", { key: "Client.Errors.userNotFound" });
        }

        assertNotBanned(user);

        try {
          await db.update(userTable)
            .set({ emailVerified: new Date() })
            .where(eq(userTable.id, verificationToken.userId));

          await updateAllSessionsOfUser(verificationToken.userId);

          // Delete the used token
          await deleteExpiringToken({
            token: input.token,
            key: getVerificationTokenKey,
          });

          return { success: true };
        } catch (error) {
          console.error(error);

          throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Errors.unexpected" });
        }
      },
      RATE_LIMITS.EMAIL
    );
  });
