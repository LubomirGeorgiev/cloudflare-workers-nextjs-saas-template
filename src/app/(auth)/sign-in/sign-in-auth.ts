import "server-only";

import { ActionError } from "@/lib/action-error";
import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { verifyPassword } from "@/utils/password-hasher";
import { createAndStoreSession } from "@/utils/auth";
import { eq } from "drizzle-orm";
import { RATE_LIMITS, withRateLimit } from "@/utils/with-rate-limit";

interface SignInWithPasswordParams {
  email: string;
  password: string;
}

export async function signInWithPassword({
  email,
  password,
}: SignInWithPasswordParams): Promise<{ success: true }> {
  return withRateLimit(
    async () => {
      const db = getDB();

      try {
        const user = await db.query.userTable.findFirst({
          where: eq(userTable.email, email),
        });

        if (!user) {
          throw new ActionError(
            "NOT_AUTHORIZED",
            "Invalid email or password"
          );
        }

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

        const isValid = await verifyPassword({
          storedHash: user.passwordHash,
          passwordAttempt: password,
        });

        if (!isValid) {
          throw new ActionError(
            "NOT_AUTHORIZED",
            "Invalid email or password"
          );
        }

        await createAndStoreSession(user.id, "password");

        return { success: true };
      } catch (error) {
        console.error(error);

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
}
