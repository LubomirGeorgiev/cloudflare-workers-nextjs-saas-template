"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { getDB } from "@/db"
import { userByEmailWhere } from "@/lib/auth/user-email";
import { userTable } from "@/db/schema"
import { signUpSchema } from "@/schemas/signup.schema";
import { hashPassword } from "@/utils/password-hasher";
import { createSessionUnlessBanned, type SignInSuccess } from "@/utils/auth";
import { sendUserVerificationEmail } from "@/utils/email-verification";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { getIP } from "@/utils/get-IP";
import { validateTurnstileToken } from "@/utils/validate-captcha";
import { isTurnstileEnabled } from "@/flags";
import { assertEmailNotBlocked } from "@/lib/auth/blocked-email-guard";
import { assertPasswordHashUnchanged } from "@/lib/auth/password-recheck";
import { getNewAccountLocale } from "@/i18n/new-account-locale";

export const signUpAction = actionClient
  .metadata({ actionName: "signUpAction" })
  .inputSchema(signUpSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async (): Promise<SignInSuccess> => {
        const db = getDB();

        if (await isTurnstileEnabled()) {
          if (!input.captchaToken) {
            throw new ActionError("INPUT_PARSE_ERROR", { key: "Client.Auth.Common.errorCaptcha" })
          }

          const success = await validateTurnstileToken(input.captchaToken)

          if (!success) {
            throw new ActionError("INPUT_PARSE_ERROR", { key: "Client.Auth.Common.errorCaptcha" })
          }
        }

        // After the captcha, before the account lookup: the blocklist governs account creation,
        // so it refuses here rather than anywhere a session is minted.
        await assertEmailNotBlocked({ email: input.email });

        const existingUser = await db.query.userTable.findFirst({
          where: userByEmailWhere(input.email),
        });

        if (existingUser) {
          throw new ActionError("CONFLICT", { key: "Client.Auth.SignUp.errorEmailTaken" });
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
            preferredLocale: await getNewAccountLocale(),
          })
          .returning();

        if (!user || !user.email) {
          throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Auth.Common.errorCreateUser" });
        }

        try {
          // A Google reclaim of this unverified row can land before the session write. It clears
          // the hash, so the recheck rolls this session back.
          const { preferredLocale } = await createSessionUnlessBanned({
            userId: user.id,
            authenticationType: "password",
            recheck: (state) => assertPasswordHashUnchanged({ state, verifiedHash: hashedPassword }),
          });

          await sendUserVerificationEmail({
            userId: user.id,
            email: user.email,
            username: user.firstName || user.email,
            returnTo: input.returnTo,
          });

          return { success: true, preferredLocale };
        } catch (error) {
          console.error(error)

          throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Auth.SignUp.errorCreateSession" });
        }
      },
      RATE_LIMITS.SIGN_UP
    );
  })
