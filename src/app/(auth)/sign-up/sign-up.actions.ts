"use server";

import { createServerAction, ZSAError } from "zsa"
import { getDB } from "@/db"
import { userTable } from "@/db/schema"
import { signUpSchema } from "@/schemas/signup.schema";
import { hashPassword } from "@/utils/password-hasher";
import { createSession, generateSessionToken, setSessionTokenCookie, canSignUp } from "@/utils/auth";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getVerificationTokenKey } from "@/utils/auth-utils";
import { sendVerificationEmail } from "@/utils/email";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS } from "@/constants";
import { getIP } from "@/utils/get-IP";
import { validateTurnstileToken } from "@/utils/validate-captcha";
import { isTurnstileEnabled } from "@/flags";
import isProd from "@/utils/is-prod";

export const signUpAction = createServerAction()
  .input(signUpSchema)
  .handler(async ({ input }) => {
    return withRateLimit(
      async () => {
        const db = getDB();
        const { env } = getCloudflareContext();

        if (await isTurnstileEnabled() && input.captchaToken) {
          const success = await validateTurnstileToken(input.captchaToken)

          if (!success) {
            throw new ZSAError(
              "INPUT_PARSE_ERROR",
              "Please complete the captcha"
            )
          }
        }

        // Check if email is disposable
        await canSignUp({ email: input.email });

        // Check if email is already taken
        const existingUser = await db.query.userTable.findFirst({
          where: eq(userTable.email, input.email),
        });

        if (existingUser) {
          throw new ZSAError(
            "CONFLICT",
            "Email already taken"
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
          throw new ZSAError(
            "INTERNAL_SERVER_ERROR",
            "Failed to create user"
          );
        }

        try {
          // Create a session
          const sessionToken = generateSessionToken();
          const session = await createSession({
            token: sessionToken,
            userId: user.id,
            authenticationType: "password",
          });

          // Set the session cookie
          await setSessionTokenCookie({
            token: sessionToken,
            userId: user.id,
            expiresAt: new Date(session.expiresAt)
          });

          // In development mode, auto-verify email
          if (!isProd) {
            // Auto-verify email in development
            await db.update(userTable)
              .set({ emailVerified: new Date() })
              .where(eq(userTable.id, user.id));
          } else {
            // Generate verification token for production
            const verificationToken = createId();
            const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS * 1000);

            if (!env?.NEXT_INC_CACHE_KV) {
              throw new Error("Can't connect to KV store");
            }

            // Save verification token in KV with expiration
            await env.NEXT_INC_CACHE_KV.put(
              getVerificationTokenKey(verificationToken),
              JSON.stringify({
                userId: user.id,
                expiresAt: expiresAt.toISOString(),
              }),
              {
                expirationTtl: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
              }
            );

            // Send verification email
            await sendVerificationEmail({
              email: user.email,
              verificationToken,
              username: user.firstName || user.email,
            });
          }
        } catch (error) {
          console.error(error)

          throw new ZSAError(
            "INTERNAL_SERVER_ERROR",
            "Failed to create session after signup"
          );
        }

        return { success: true };
      },
      RATE_LIMITS.SIGN_UP
    );
  })
