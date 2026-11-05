"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { googleSSOCallbackSchema } from "@/schemas/google-sso-callback.schema";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import {
  GOOGLE_OAUTH_CODE_VERIFIER_COOKIE_NAME,
  GOOGLE_OAUTH_LOCALE_COOKIE_NAME,
  GOOGLE_OAUTH_STATE_COOKIE_NAME,
} from "@/constants";
import { cookies } from "next/headers";
import {
  parseGoogleIdToken,
  validateGoogleAuthorizationCode,
  type GoogleIdTokenClaims,
} from "@/lib/sso/google-sso";
import { getDB } from "@/db";
import { eq } from "drizzle-orm";
import { passKeyCredentialTable, userTable } from "@/db/schema";
import { userByEmailWhere } from "@/lib/auth/user-email";
import { normalizeEmail } from "@/lib/validation";
import { deleteAllSessionsOfUser } from "@/utils/kv-session";
import { createAndStoreSession, createSessionUnlessBanned, type SignInSuccess } from "@/utils/auth";
import { isGoogleSSOEnabled } from "@/flags";
import { getIP } from "@/utils/get-IP";
import { sendUserVerificationEmail } from "@/utils/email-verification";
import { assertEmailNotBlocked } from "@/lib/auth/blocked-email-guard";
import { assertNotBanned } from "@/lib/account/ban";
import { invalidateCmsAuthorAfterUserWrite } from "@/lib/cms/cms-author-cache-invalidation";
import { getNewAccountLocale } from "@/i18n/new-account-locale";
import { runInBackground } from "@/utils/run-in-background";

// Written by the `/sso/google` route with `path: "/"`; a delete must name the same path to match.
const GOOGLE_OAUTH_COOKIE_NAMES = [
  GOOGLE_OAUTH_STATE_COOKIE_NAME,
  GOOGLE_OAUTH_CODE_VERIFIER_COOKIE_NAME,
  GOOGLE_OAUTH_LOCALE_COOKIE_NAME,
] as const;
const GOOGLE_OAUTH_COOKIE_PATH = "/";

export const googleSSOCallbackAction = actionClient
  .metadata({ actionName: "googleSSOCallbackAction" })
  .inputSchema(googleSSOCallbackSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(async (): Promise<SignInSuccess> => {

      if (!(await isGoogleSSOEnabled())) {
        throw new ActionError("FORBIDDEN", { key: "Client.Auth.GoogleCallback.errorNotEnabled" });
      }

      const cookieStore = await cookies();
      const cookieState = cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE_NAME)?.value ?? null;
      const cookieCodeVerifier = cookieStore.get(GOOGLE_OAUTH_CODE_VERIFIER_COOKIE_NAME)?.value ?? null;
      const entryLocale = cookieStore.get(GOOGLE_OAUTH_LOCALE_COOKIE_NAME)?.value;

      if (!cookieState || !cookieCodeVerifier) {
        throw new ActionError("NOT_AUTHORIZED", { key: "Client.Auth.GoogleCallback.errorMissingCookies" });
      }

      if (input.state !== cookieState) {
        throw new ActionError("NOT_AUTHORIZED", { key: "Client.Auth.GoogleCallback.errorInvalidState" });
      }

      // The exchange below spends the code even when it fails, so a retry must restart at `/sso/google`.
      // Not earlier: a forged callback with a wrong state must not clear a real flow in progress.
      deleteGoogleOAuthCookies(cookieStore);

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
      const email = normalizeEmail(claims.email);

      const db = getDB();

      try {
        // First check if user exists with this Google account ID
        const existingUserWithGoogle = await db.query.userTable.findFirst({
          where: { googleAccountId },
        });

        if (existingUserWithGoogle?.id) {
          // After Google proved the identity, so the refusal reveals nothing to a stranger.
          assertNotBanned(existingUserWithGoogle);

          const { preferredLocale } = await createSessionUnlessBanned({
            userId: existingUserWithGoogle.id,
            authenticationType: "google-oauth",
          });
          return { success: true, preferredLocale };
        }

        const existingUserWithEmail = await db.query.userTable.findFirst({
          where: userByEmailWhere(email),
        });

        if (existingUserWithEmail?.id) {
          assertNotBanned(existingUserWithEmail);

          // Only a mailbox Google verified may claim an existing account by email.
          if (claims.email_verified !== true) {
            throw new ActionError("NOT_AUTHORIZED", { key: "Client.Auth.GoogleCallback.errorEmailNotVerified" });
          }

          const userId = existingUserWithEmail.id;
          const updatedUser = existingUserWithEmail.emailVerified
            ? await linkGoogleToVerifiedUser({
              userId,
              googleAccountId,
              avatarUrl,
              existingAvatar: existingUserWithEmail.avatar,
            })
            : await reclaimUnverifiedUser({ userId, googleAccountId, avatarUrl });

          // The link can give an author their first avatar, which public CMS pages render. The
          // sign-in does not wait for the purge chain.
          runInBackground(invalidateCmsAuthorAfterUserWrite({
            userId: updatedUser.id,
            before: existingUserWithEmail,
            after: updatedUser,
          }));

          const { preferredLocale } = await createSessionUnlessBanned({
            userId: updatedUser.id,
            authenticationType: "google-oauth",
          });
          return { success: true, preferredLocale };
        }

        // No existing user found - create a new one. The blocklist is checked ONLY here: the two
        // branches above sign an existing account in, and the lever for one of those is a ban.
        await assertEmailNotBlocked({ email });

        const [user] = await db.insert(userTable)
          .values({
            googleAccountId,
            firstName: claims.given_name || claims.name || null,
            lastName: claims.family_name || null,
            avatar: avatarUrl,
            email,
            emailVerified: claims?.email_verified ? new Date() : null,
            signUpIpAddress: await getIP(),
            // A first sign-in with Google is a sign-up. The callback URL is bare, so the entry locale wins.
            preferredLocale: await getNewAccountLocale({ entryLocale }),
          })
          .returning();

        if (!user.emailVerified && user.email) {
          await sendUserVerificationEmail({
            userId: user.id,
            email: user.email,
            username: user.firstName || user.email,
          });
        }

        const { preferredLocale } = await createAndStoreSession(user.id, "google-oauth");
        return { success: true, preferredLocale };

      } catch (error) {
        console.error(error);

        if (error instanceof ActionError) {
          throw error;
        }

        throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Errors.unexpected" });
      }
    }, RATE_LIMITS.GOOGLE_SSO_CALLBACK);
  });

// The row and Google both proved the same mailbox, so its existing credentials stay.
async function linkGoogleToVerifiedUser({
  userId,
  googleAccountId,
  avatarUrl,
  existingAvatar,
}: {
  userId: string;
  googleAccountId: string;
  avatarUrl: string | undefined;
  existingAvatar: string | null;
}) {
  const [updatedUser] = await getDB()
    .update(userTable)
    .set({ googleAccountId, avatar: existingAvatar || avatarUrl })
    .where(eq(userTable.id, userId))
    .returning();

  return updatedUser;
}

// Nobody proved the mailbox of an unverified row, so its password, passkeys, and sessions may
// belong to someone who pre-registered the address.
async function reclaimUnverifiedUser({
  userId,
  googleAccountId,
  avatarUrl,
}: {
  userId: string;
  googleAccountId: string;
  avatarUrl: string | undefined;
}) {
  // A claimed row never comes back to this path, so a retry cannot repeat a failed revoke. This
  // first revoke limits what a failed second one leaves to sessions written during this call.
  await deleteAllSessionsOfUser(userId);

  const db = getDB();
  const [[updatedUser]] = await db.batch([
    db.update(userTable)
      .set({ googleAccountId, avatar: avatarUrl ?? null, passwordHash: null, emailVerified: new Date() })
      .where(eq(userTable.id, userId))
      .returning(),
    db.delete(passKeyCredentialTable).where(eq(passKeyCredentialTable.userId, userId)),
  ]);

  // After the batch: this catches a session written before it. A sign-in or sign-up that writes its
  // session after this sees the claimed row on its recheck (`createSessionUnlessBanned`) and rolls back.
  await deleteAllSessionsOfUser(userId);

  return updatedUser;
}

function deleteGoogleOAuthCookies(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  for (const name of GOOGLE_OAUTH_COOKIE_NAMES) {
    cookieStore.delete({ name, path: GOOGLE_OAUTH_COOKIE_PATH });
  }
}
