"use server";

import {
  generatePasskeyRegistrationOptions,
  verifyPasskeyRegistration,
  generateDiscoverablePasskeyAuthenticationOptions,
  verifyPasskeyAuthentication
} from "@/utils/webauthn";
import { getDB } from "@/db";
import { userTable, passKeyCredentialTable } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { requireVerifiedEmail, createAndStoreSession } from "@/utils/auth";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";
import { cookies, headers } from "next/headers";
import { getIP } from "@/utils/get-IP";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import isProd from "@/utils/is-prod";
import ms from "ms";
import { emailString, v } from "@/lib/validation";

const generateRegistrationOptionsSchema = v.object({
  email: emailString(),
});

const PASSKEY_REGISTRATION_CHALLENGE_COOKIE_NAME = "passkey_registration_challenge";
const PASSKEY_AUTHENTICATION_CHALLENGE_COOKIE_NAME = "passkey_authentication_challenge";
const PASSKEY_CHALLENGE_TTL_SECONDS = Math.floor(ms("10 minutes") / 1000);

export const generateRegistrationOptionsAction = actionClient
  .inputSchema(generateRegistrationOptionsSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(async () => {
      // Check if user is logged in and email is verified
      const session = await requireVerifiedEmail();

      const db = getDB();
      const user = await db.query.userTable.findFirst({
        where: eq(userTable.email, input.email),
      });

      if (!user) {
        throw new ActionError("NOT_FOUND", "User not found");
      }

      // Verify the email matches the logged-in user
      if (user.id !== session?.user?.id) {
        throw new ActionError("FORBIDDEN", "You can only register passkeys for your own account");
      }

      // Check if user has reached the passkey limit
      const existingPasskeys = await db
        .select()
        .from(passKeyCredentialTable)
        .where(eq(passKeyCredentialTable.userId, user.id));

      if (existingPasskeys.length >= 5) {
        throw new ActionError(
          "FORBIDDEN",
          "You have reached the maximum limit of 5 passkeys"
        );
      }

      const options = await generatePasskeyRegistrationOptions(user.id, input.email);
      const cookieStore = await cookies();

      cookieStore.set(PASSKEY_REGISTRATION_CHALLENGE_COOKIE_NAME, options.challenge, {
        httpOnly: true,
        secure: isProd,
        sameSite: "strict",
        path: "/",
        maxAge: PASSKEY_CHALLENGE_TTL_SECONDS,
      });

      return options;
    }, RATE_LIMITS.SETTINGS);
  });

const verifyRegistrationSchema = v.object({
  email: emailString(),
  response: v.custom<RegistrationResponseJSON>(() => true),
});

export const verifyRegistrationAction = actionClient
  .inputSchema(verifyRegistrationSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(async () => {
      // Check if user is logged in and email is verified
      const session = await requireVerifiedEmail();

      const db = getDB();
      const user = await db.query.userTable.findFirst({
        where: eq(userTable.email, input.email),
      });

      if (!user) {
        throw new ActionError("NOT_FOUND", "User not found");
      }

      // Verify the email matches the logged-in user
      if (user.id !== session?.user?.id) {
        throw new ActionError("FORBIDDEN", "You can only register passkeys for your own account");
      }

      const cookieStore = await cookies();
      const challenge = cookieStore.get(PASSKEY_REGISTRATION_CHALLENGE_COOKIE_NAME)?.value;

      if (!challenge) {
        throw new ActionError("PRECONDITION_FAILED", "Invalid registration session");
      }

      try {
        await verifyPasskeyRegistration({
          userId: user.id,
          response: input.response,
          challenge,
          userAgent: (await headers()).get("user-agent"),
          ipAddress: await getIP(),
        });
        await createAndStoreSession(user.id, "passkey", input.response.id);
        return { success: true };
      } catch (error) {
        if (error instanceof ActionError) {
          throw error;
        }

        throw new ActionError("PRECONDITION_FAILED", "Failed to register passkey");
      } finally {
        cookieStore.delete(PASSKEY_REGISTRATION_CHALLENGE_COOKIE_NAME);
      }
    }, RATE_LIMITS.SETTINGS);
  });

const deletePasskeySchema = v.object({
  credentialId: v.string(),
});

export const deletePasskeyAction = actionClient
  .inputSchema(deletePasskeySchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(async () => {
      const session = await requireVerifiedEmail();
      const userId = session?.user?.id;

      if (!userId) {
        throw new ActionError("NOT_AUTHORIZED", "Not authenticated");
      }

      // Prevent deletion of the current passkey
      if (session?.passkeyCredentialId === input.credentialId) {
        throw new ActionError(
          "FORBIDDEN",
          "Cannot delete the current passkey"
        );
      }

      const db = getDB();

      const passkey = await db.query.passKeyCredentialTable.findFirst({
        where: and(
          eq(passKeyCredentialTable.credentialId, input.credentialId),
          eq(passKeyCredentialTable.userId, userId)
        ),
      });

      if (!passkey) {
        throw new ActionError("NOT_FOUND", "Passkey not found");
      }

      // Get all user's passkeys
      const passkeys = await db
        .select()
        .from(passKeyCredentialTable)
        .where(eq(passKeyCredentialTable.userId, userId));

      // Get full user data to check password
      const user = await db.query.userTable.findFirst({
        where: eq(userTable.id, userId),
      });

      if (!user) {
        throw new ActionError("NOT_FOUND", "User not found");
      }

      // Check if this is the last passkey and if the user has a password
      if (passkeys.length === 1 && !user.passwordHash) {
        throw new ActionError(
          "FORBIDDEN",
          "Cannot delete the last passkey when no password is set"
        );
      }

      await db
        .delete(passKeyCredentialTable)
        .where(and(
          eq(passKeyCredentialTable.credentialId, input.credentialId),
          eq(passKeyCredentialTable.userId, userId)
        ));

      return { success: true };
    }, RATE_LIMITS.SETTINGS);
  });

export const generateAuthenticationOptionsAction = actionClient
  .inputSchema(v.void())
  .action(async () => {
    return withRateLimit(async () => {
      const cookieStore = await cookies();
      const options = await generateDiscoverablePasskeyAuthenticationOptions();

      cookieStore.set(PASSKEY_AUTHENTICATION_CHALLENGE_COOKIE_NAME, options.challenge, {
        httpOnly: true,
        secure: isProd,
        sameSite: "strict",
        path: "/",
        maxAge: PASSKEY_CHALLENGE_TTL_SECONDS,
      });

      return options;
    }, RATE_LIMITS.SIGN_IN);
  });

const verifyAuthenticationSchema = v.object({
  response: v.custom<AuthenticationResponseJSON>((val): val is AuthenticationResponseJSON => {
    return typeof val === "object" && val !== null && "id" in val && "rawId" in val;
  }, "Invalid authentication response"),
});

export const verifyAuthenticationAction = actionClient
  .inputSchema(verifyAuthenticationSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(async () => {
      const cookieStore = await cookies();
      const challenge = cookieStore.get(PASSKEY_AUTHENTICATION_CHALLENGE_COOKIE_NAME)?.value;

      if (!challenge) {
        throw new ActionError("PRECONDITION_FAILED", "Invalid authentication session");
      }

      try {
        const { verification, credential } = await verifyPasskeyAuthentication({
          response: input.response,
          challenge,
        });

        if (!verification.verified) {
          throw new ActionError("FORBIDDEN", "Passkey authentication failed");
        }

        await createAndStoreSession(credential.userId, "passkey", input.response.id);
        return { success: true };
      } catch (error) {
        if (error instanceof ActionError) {
          throw error;
        }

        throw new ActionError("FORBIDDEN", "Passkey authentication failed");
      } finally {
        cookieStore.delete(PASSKEY_AUTHENTICATION_CHALLENGE_COOKIE_NAME);
      }
    }, RATE_LIMITS.SIGN_IN);
  });
