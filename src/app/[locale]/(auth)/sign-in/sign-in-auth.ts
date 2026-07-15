import "server-only";

import { ActionError } from "@/lib/action-error";
import { getDB } from "@/db";
import { verifyPassword } from "@/utils/password-hasher";
import { createAndStoreSession } from "@/utils/auth";
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
          where: { email: email },
        });

        if (!user) {
          throw new ActionError("NOT_AUTHORIZED", { key: "Client.Auth.SignIn.errorInvalidCredentials" });
        }

        if (!user.passwordHash && user.googleAccountId) {
          throw new ActionError("FORBIDDEN", { key: "Client.Auth.SignIn.errorUseGoogle" });
        }

        if (!user.passwordHash) {
          throw new ActionError("NOT_AUTHORIZED", { key: "Client.Auth.SignIn.errorInvalidCredentials" });
        }

        const isValid = await verifyPassword({
          storedHash: user.passwordHash,
          passwordAttempt: password,
        });

        if (!isValid) {
          throw new ActionError("NOT_AUTHORIZED", { key: "Client.Auth.SignIn.errorInvalidCredentials" });
        }

        const passkey = await db.query.passKeyCredentialTable.findFirst({
          where: { userId: user.id },
          columns: {
            id: true,
          },
        });

        if (passkey) {
          throw new ActionError("FORBIDDEN", { key: "Client.Auth.SignIn.errorUsePasskey" });
        }

        await createAndStoreSession(user.id, "password");

        return { success: true };
      } catch (error) {
        console.error(error);

        if (error instanceof ActionError) {
          throw error;
        }

        throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Errors.unexpected" });
      }
    },
    RATE_LIMITS.SIGN_IN
  );
}
