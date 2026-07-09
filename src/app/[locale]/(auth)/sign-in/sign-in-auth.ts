import "server-only";

import { getTranslations } from "next-intl/server";
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
      const t = await getTranslations("Client.Auth.SignIn");
      const tErrors = await getTranslations("Client.Errors");
      const db = getDB();

      try {
        const user = await db.query.userTable.findFirst({
          where: { email: email },
        });

        if (!user) {
          throw new ActionError(
            "NOT_AUTHORIZED",
            t("errorInvalidCredentials")
          );
        }

        if (!user.passwordHash && user.googleAccountId) {
          throw new ActionError(
            "FORBIDDEN",
            t("errorUseGoogle")
          );
        }

        if (!user.passwordHash) {
          throw new ActionError(
            "NOT_AUTHORIZED",
            t("errorInvalidCredentials")
          );
        }

        const isValid = await verifyPassword({
          storedHash: user.passwordHash,
          passwordAttempt: password,
        });

        if (!isValid) {
          throw new ActionError(
            "NOT_AUTHORIZED",
            t("errorInvalidCredentials")
          );
        }

        const passkey = await db.query.passKeyCredentialTable.findFirst({
          where: { userId: user.id },
          columns: {
            id: true,
          },
        });

        if (passkey) {
          throw new ActionError(
            "FORBIDDEN",
            t("errorUsePasskey")
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
          tErrors("unexpected")
        );
      }
    },
    RATE_LIMITS.SIGN_IN
  );
}
