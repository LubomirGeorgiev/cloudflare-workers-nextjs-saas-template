"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { generatePasskeyRegistrationOptions, verifyPasskeyRegistration } from "@/utils/webauthn";
import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { cookies, headers } from "next/headers";
import { createAndStoreSession, canSignUp } from "@/utils/auth";
import type { RegistrationResponseJSON, PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/server";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { getIP } from "@/utils/get-IP";
import { sendUserVerificationEmail } from "@/utils/email-verification";
import { passkeyEmailSchema } from "@/schemas/passkey.schema";
import ms from "ms";
import { validateTurnstileToken } from "@/utils/validate-captcha";
import { isTurnstileEnabled } from "@/flags";
import { v, validationKey } from "@/lib/validation";
import { shouldUseSecureCookies } from "@/utils/cookie-security";

const PASSKEY_CHALLENGE_COOKIE_NAME = "passkey_challenge";
const PASSKEY_USER_ID_COOKIE_NAME = "passkey_user_id";

export const startPasskeyRegistrationAction = actionClient
  .inputSchema(passkeyEmailSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {

        if (await isTurnstileEnabled()) {
          if (!input.captchaToken) {
            throw new ActionError("INPUT_PARSE_ERROR", { key: "Client.Auth.Common.errorCaptcha" })
          }

          const success = await validateTurnstileToken(input.captchaToken)

          if (!success) {
            throw new ActionError("INPUT_PARSE_ERROR", { key: "Client.Auth.Common.errorCaptcha" })
          }
        }

        const db = getDB();

        await canSignUp({ email: input.email });

        const existingUser = await db.query.userTable.findFirst({
          where: { email: input.email },
        });

        if (existingUser) {
          throw new ActionError("CONFLICT", { key: "Client.Auth.SignUp.errorAccountExists" });
        }

        const ipAddress = await getIP();

        const [user] = await db.insert(userTable)
          .values({
            email: input.email,
            firstName: input.firstName,
            lastName: input.lastName,
            signUpIpAddress: ipAddress,
          })
          .returning();

        if (!user) {
          throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Auth.Common.errorCreateUser" });
        }

        const options = await generatePasskeyRegistrationOptions(user.id, input.email);

        const cookieStore = await cookies();
        const secure = await shouldUseSecureCookies();

        // Store the challenge in a cookie for verification
        cookieStore.set(PASSKEY_CHALLENGE_COOKIE_NAME, options.challenge, {
          httpOnly: true,
          secure,
          sameSite: "strict",
          path: "/",
          maxAge: Math.floor(ms("10 minutes") / 1000),
        });

        // Store the user ID in a cookie for verification
        cookieStore.set(PASSKEY_USER_ID_COOKIE_NAME, user.id, {
          httpOnly: true,
          secure,
          sameSite: "strict",
          path: "/",
          maxAge: Math.floor(ms("10 minutes") / 1000),
        });

        // Convert options to the expected type
        const optionsJSON: PublicKeyCredentialCreationOptionsJSON = {
          rp: options.rp,
          user: options.user,
          challenge: options.challenge,
          pubKeyCredParams: options.pubKeyCredParams,
          timeout: options.timeout,
          excludeCredentials: options.excludeCredentials,
          authenticatorSelection: options.authenticatorSelection,
          attestation: options.attestation,
          extensions: options.extensions,
        };

        return { optionsJSON };
      },
      RATE_LIMITS.SIGN_UP
    );
  });

const completePasskeyRegistrationSchema = v.object({
  response: v.custom<RegistrationResponseJSON>((val): val is RegistrationResponseJSON => {
    return typeof val === "object" && val !== null && "id" in val && "rawId" in val;
  }, validationKey("invalidRegistrationResponse")),
});

export const completePasskeyRegistrationAction = actionClient
  .inputSchema(completePasskeyRegistrationSchema)
  .action(async ({ parsedInput: input }) => {
    const cookieStore = await cookies();
    const challenge = cookieStore.get(PASSKEY_CHALLENGE_COOKIE_NAME)?.value;
    const userId = cookieStore.get(PASSKEY_USER_ID_COOKIE_NAME)?.value;

    if (!challenge || !userId) {
      throw new ActionError("PRECONDITION_FAILED", { key: "Client.Auth.SignUp.errorInvalidRegistrationSession" });
    }

    try {
      // Verify the registration
      await verifyPasskeyRegistration({
        userId,
        response: input.response,
        challenge,
        userAgent: (await headers()).get("user-agent"),
        ipAddress: await getIP(),
      });

      const db = getDB();
      const user = await db.query.userTable.findFirst({
        where: { id: userId },
      });

      if (!user || !user.email) {
        throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Errors.userNotFound" });
      }

      await sendUserVerificationEmail({
        userId: user.id,
        email: user.email,
        username: user.firstName || user.email,
      });

      await createAndStoreSession(userId, "passkey", input.response.id);

      // Clean up cookies
      cookieStore.delete(PASSKEY_CHALLENGE_COOKIE_NAME);
      cookieStore.delete(PASSKEY_USER_ID_COOKIE_NAME);

      return { success: true };
    } catch (error) {
      console.error("Failed to register passkey:", error);
      throw new ActionError("PRECONDITION_FAILED", { key: "Client.Auth.SignUp.errorRegisterFailed" });
    }
  });
