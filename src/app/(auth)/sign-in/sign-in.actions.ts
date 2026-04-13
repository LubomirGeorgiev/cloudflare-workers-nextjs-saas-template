"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { signInSchema } from "@/schemas/signin.schema";
import { verifyPassword } from "@/utils/password-hasher";
import { createAndStoreSession } from "@/utils/auth";
import { eq } from "drizzle-orm";
import { RATE_LIMITS, withRateLimit } from "@/utils/with-rate-limit";

export const signInAction = actionClient
  .inputSchema(signInSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        const db = getDB();

        try {
          // Find user by email
          const user = await db.query.userTable.findFirst({
            where: eq(userTable.email, input.email),
          });

          if (!user) {
            throw new ActionError(
              "NOT_AUTHORIZED",
              "Invalid email or password"
            );
          }

          // Check if user has only Google SSO
          if (!user.passwordHash && user.googleAccountId) {
            throw new ActionError(
              "FORBIDDEN",
              "Please sign in with your Google account instead."
            );
          }

          if (!user.passwordHash) {
            throw new ActionError(
              "NOT_AUTHORIZED",
              "Invalid email or password"
            );
          }

          // Verify password
          const isValid = await verifyPassword({
            storedHash: user.passwordHash,
            passwordAttempt: input.password
          });

          if (!isValid) {
            throw new ActionError(
              "NOT_AUTHORIZED",
              "Invalid email or password"
            );
          }

          // Create session
          await createAndStoreSession(user.id, "password")

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
      RATE_LIMITS.SIGN_IN
    );
  });
