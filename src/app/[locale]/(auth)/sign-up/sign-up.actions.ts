"use server";

import { getTranslations } from "next-intl/server";
import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { getDB } from "@/db"
import { userTable } from "@/db/schema"
import { signUpSchema } from "@/schemas/signup.schema";
import { hashPassword } from "@/utils/password-hasher";
import { createAndStoreSession, canSignUp } from "@/utils/auth";
import { sendUserVerificationEmail } from "@/utils/email-verification";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { getIP } from "@/utils/get-IP";
import { validateTurnstileToken } from "@/utils/validate-captcha";
import { isTurnstileEnabled } from "@/flags";

export const signUpAction = actionClient
  .inputSchema(signUpSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        const t = await getTranslations("Client.Auth.SignUp");
        const tCommon = await getTranslations("Client.Auth.Common");
        const db = getDB();

        if (await isTurnstileEnabled()) {
          if (!input.captchaToken) {
            throw new ActionError(
              "INPUT_PARSE_ERROR",
              tCommon("errorCaptcha")
            )
          }

          const success = await validateTurnstileToken(input.captchaToken)

          if (!success) {
            throw new ActionError(
              "INPUT_PARSE_ERROR",
              tCommon("errorCaptcha")
            )
          }
        }

        await canSignUp({ email: input.email });

        const existingUser = await db.query.userTable.findFirst({
          where: { email: input.email },
        });

        if (existingUser) {
          throw new ActionError(
            "CONFLICT",
            t("errorEmailTaken")
          );
        }

        // Hash the password
        const hashedPassword = await hashPassword({ password: input.password });

        // Create the user
        const [user] = await db.insert(userTable)
          .values({
            email: input.email,
            firstName: input.firstName,
            lastName: input.lastName,
            passwordHash: hashedPassword,
            signUpIpAddress: await getIP(),
          })
          .returning();

        if (!user || !user.email) {
          throw new ActionError(
            "INTERNAL_SERVER_ERROR",
            tCommon("errorCreateUser")
          );
        }

        try {
          await createAndStoreSession(user.id, "password");

          await sendUserVerificationEmail({
            userId: user.id,
            email: user.email,
            username: user.firstName || user.email,
          });
        } catch (error) {
          console.error(error)

          throw new ActionError(
            "INTERNAL_SERVER_ERROR",
            t("errorCreateSession")
          );
        }

        return { success: true };
      },
      RATE_LIMITS.SIGN_UP
    );
  })
