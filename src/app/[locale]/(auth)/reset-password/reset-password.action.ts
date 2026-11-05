"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { resetPasswordSchema } from "@/schemas/reset-password.schema";
import { hashPassword } from "@/utils/password-hasher";
import { eq } from "drizzle-orm";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import {
  getValidPasswordResetToken,
  revokePasswordResetTokensOfUser,
} from "@/utils/password-reset-token";
import { deleteAllSessionsOfUser } from "@/utils/kv-session";
import { assertNotBanned } from "@/lib/account/ban";

export const resetPasswordAction = actionClient
  .metadata({ actionName: "resetPasswordAction" })
  .inputSchema(resetPasswordSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        const db = getDB();

        try {
          const resetToken = await getValidPasswordResetToken(input.token);

          // Find user
          const user = await db.query.userTable.findFirst({
            where: { id: resetToken.userId },
          });

          if (!user) {
            throw new ActionError("NOT_FOUND", { key: "Client.Errors.userNotFound" });
          }

          // The token holder has proved they control the address, so naming the suspension here
          // reveals nothing they could not already learn from the sign-in form.
          assertNotBanned(user);

          const passwordHash = await hashPassword({ password: input.password });

          // Write before the revoke: a sign-in that writes its session after the revoke then sees
          // the new hash on its recheck (`sign-in-auth.ts`) and rolls the session back.
          await db.update(userTable)
            .set({ passwordHash })
            .where(eq(userTable.id, resetToken.userId));

          // Sessions before the link revoke, which also kills this link: a failed session revoke
          // then leaves this link valid, so a retry runs the revoke again.
          await deleteAllSessionsOfUser(resetToken.userId);
          await revokePasswordResetTokensOfUser(resetToken.userId);

          return { success: true };
        } catch (error) {
          console.error(error)

          if (error instanceof ActionError) {
            throw error;
          }

          throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Errors.unexpected" });
        }
      },
      RATE_LIMITS.RESET_PASSWORD
    );
  });
