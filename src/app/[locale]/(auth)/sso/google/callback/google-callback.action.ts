"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { googleSSOCallbackSchema } from "@/schemas/google-sso-callback.schema";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { GOOGLE_OAUTH_CODE_VERIFIER_COOKIE_NAME, GOOGLE_OAUTH_STATE_COOKIE_NAME } from "@/constants";
import { cookies } from "next/headers";
import {
  parseGoogleIdToken,
  validateGoogleAuthorizationCode,
  type GoogleIdTokenClaims,
} from "@/lib/sso/google-sso";
import { getDB } from "@/db";
import { eq } from "drizzle-orm";
import { userTable } from "@/db/schema";
import { createAndStoreSession } from "@/utils/auth";
import { isGoogleSSOEnabled } from "@/flags";
import { getIP } from "@/utils/get-IP";
import { sendUserVerificationEmail } from "@/utils/email-verification";

export const googleSSOCallbackAction = actionClient
  .inputSchema(googleSSOCallbackSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(async () => {

      if (!(await isGoogleSSOEnabled())) {
        throw new ActionError("FORBIDDEN", { key: "Client.Auth.GoogleCallback.errorNotEnabled" });
      }

      const cookieStore = await cookies();
      const cookieState = cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE_NAME)?.value ?? null;
      const cookieCodeVerifier = cookieStore.get(GOOGLE_OAUTH_CODE_VERIFIER_COOKIE_NAME)?.value ?? null;

      if (!cookieState || !cookieCodeVerifier) {
        throw new ActionError("NOT_AUTHORIZED", { key: "Client.Auth.GoogleCallback.errorMissingCookies" });
      }

      if (input.state !== cookieState) {
        throw new ActionError("NOT_AUTHORIZED", { key: "Client.Auth.GoogleCallback.errorInvalidState" });
      }

      let idToken: string;
      try {
        idToken = await validateGoogleAuthorizationCode({
          code: input.code,
          codeVerifier: cookieCodeVerifier,
        });
      } catch (error) {
        console.error("Google OAuth callback: Error validating authorization code", error);
        throw new ActionError("NOT_AUTHORIZED", { key: "Client.Auth.GoogleCallback.errorInvalidCode" });
      }

      let claims: GoogleIdTokenClaims;
      try {
        claims = parseGoogleIdToken(idToken);
      } catch (error) {
        console.error("Google OAuth callback: Rejected ID token", error);
        throw new ActionError("NOT_AUTHORIZED", { key: "Client.Auth.GoogleCallback.errorInvalidIdToken" });
      }

      const googleAccountId = claims.sub;
      const avatarUrl = claims.picture;
      const email = claims.email;

      const db = getDB();

      try {
        // First check if user exists with this Google account ID
        const existingUserWithGoogle = await db.query.userTable.findFirst({
          where: { googleAccountId },
        });

        if (existingUserWithGoogle?.id) {
          await createAndStoreSession(existingUserWithGoogle.id, "google-oauth");
          return { success: true };
        }

        // Then check if user exists with this email
        const existingUserWithEmail = await db.query.userTable.findFirst({
          where: { email },
        });

        if (existingUserWithEmail?.id) {
          // User exists but hasn't linked Google - let's link their account
          const [updatedUser] = await db
            .update(userTable)
            .set({
              googleAccountId,
              avatar: existingUserWithEmail.avatar || avatarUrl,
              emailVerified: existingUserWithEmail.emailVerified || (claims?.email_verified ? new Date() : null),
            })
            .where(eq(userTable.id, existingUserWithEmail.id))
            .returning();

          await createAndStoreSession(updatedUser.id, "google-oauth");
          return { success: true };
        }

        // No existing user found - create a new one
        const [user] = await db.insert(userTable)
          .values({
            googleAccountId,
            firstName: claims.given_name || claims.name || null,
            lastName: claims.family_name || null,
            avatar: avatarUrl,
            email,
            emailVerified: claims?.email_verified ? new Date() : null,
            signUpIpAddress: await getIP(),
          })
          .returning();

        if (!user.emailVerified && user.email) {
          await sendUserVerificationEmail({
            userId: user.id,
            email: user.email,
            username: user.firstName || user.email,
          });
        }

        await createAndStoreSession(user.id, "google-oauth");
        return { success: true };

      } catch (error) {
        console.error(error);

        if (error instanceof ActionError) {
          throw error;
        }

        throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Errors.unexpected" });
      }
    }, RATE_LIMITS.GOOGLE_SSO_CALLBACK);
  });
