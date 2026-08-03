"use server";

import {
  generatePasskeyRegistrationOptions,
  verifyPasskeyRegistration,
  generateDiscoverablePasskeyAuthenticationOptions,
  verifyPasskeyAuthentication
} from "@/utils/webauthn";
import { getDB } from "@/db";
import { passKeyCredentialTable } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { requireVerifiedEmail, createAndStoreSession } from "@/utils/auth";
import { cookies, headers } from "next/headers";
import { getIP } from "@/utils/get-IP";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { withUserRateLimit } from "@/utils/with-user-rate-limit";
import { v } from "@/lib/validation";
import {
  deletePasskeySchema,
  generateRegistrationOptionsSchema,
  verifyAuthenticationSchema,
  verifyRegistrationSchema,
} from "@/schemas/passkey.schema";
import { shouldUseSecureCookies } from "@/utils/cookie-security";
import {
  consumeWebAuthnChallenge,
  storeWebAuthnChallenge,
  WEBAUTHN_CHALLENGE_PURPOSE,
  WEBAUTHN_CHALLENGE_TTL_SECONDS,
} from "@/utils/webauthn-challenge";

const PASSKEY_REGISTRATION_CHALLENGE_COOKIE_NAME = "passkey_registration_challenge";
const PASSKEY_AUTHENTICATION_CHALLENGE_COOKIE_NAME = "passkey_authentication_challenge";

export const generateRegistrationOptionsAction = actionClient
  .inputSchema(generateRegistrationOptionsSchema)
  .action(async ({ parsedInput: input }) => {
    return withUserRateLimit(async () => {
      const session = await requireVerifiedEmail();

      const db = getDB();
      const user = await db.query.userTable.findFirst({
        where: { email: input.email },
      });

      if (!user) {
        throw new ActionError("NOT_FOUND", { key: "Client.Errors.userNotFound" });
      }

      // Verify the email matches the logged-in user
      if (user.id !== session?.user?.id) {
        throw new ActionError("FORBIDDEN", { key: "Client.Settings.Security.errorRegisterOwnAccount" });
      }

      const existingPasskeys = await db
        .select()
        .from(passKeyCredentialTable)
        .where(eq(passKeyCredentialTable.userId, user.id));

      if (existingPasskeys.length >= 5) {
        throw new ActionError("FORBIDDEN", { key: "Client.Settings.Security.errorPasskeyLimit", params: { limit: 5 } });
      }

      const options = await generatePasskeyRegistrationOptions(user.id, input.email);
      await storeWebAuthnChallenge({
        challenge: options.challenge,
        purpose: WEBAUTHN_CHALLENGE_PURPOSE.REGISTRATION,
        userId: user.id,
      });
      const cookieStore = await cookies();
      const secure = await shouldUseSecureCookies();

      cookieStore.set(PASSKEY_REGISTRATION_CHALLENGE_COOKIE_NAME, options.challenge, {
        httpOnly: true,
        secure,
        sameSite: "strict",
        path: "/",
        maxAge: WEBAUTHN_CHALLENGE_TTL_SECONDS,
      });

      return options;
    }, RATE_LIMITS.SETTINGS);
  });

export const verifyRegistrationAction = actionClient
  .inputSchema(verifyRegistrationSchema)
  .action(async ({ parsedInput: input }) => {
    return withUserRateLimit(async () => {
      const session = await requireVerifiedEmail();

      const db = getDB();
      const user = await db.query.userTable.findFirst({
        where: { email: input.email },
      });

      if (!user) {
        throw new ActionError("NOT_FOUND", { key: "Client.Errors.userNotFound" });
      }

      // Verify the email matches the logged-in user
      if (user.id !== session?.user?.id) {
        throw new ActionError("FORBIDDEN", { key: "Client.Settings.Security.errorRegisterOwnAccount" });
      }

      const cookieStore = await cookies();
      const challenge = cookieStore.get(PASSKEY_REGISTRATION_CHALLENGE_COOKIE_NAME)?.value;

      if (!challenge) {
        throw new ActionError("PRECONDITION_FAILED", { key: "Client.Settings.Security.errorInvalidRegistrationSession" });
      }

      cookieStore.delete(PASSKEY_REGISTRATION_CHALLENGE_COOKIE_NAME);

      const challengePayload = await consumeWebAuthnChallenge({
        challenge,
        purpose: WEBAUTHN_CHALLENGE_PURPOSE.REGISTRATION,
      });

      if (challengePayload?.userId !== user.id) {
        throw new ActionError("PRECONDITION_FAILED", { key: "Client.Settings.Security.errorInvalidRegistrationSession" });
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

        throw new ActionError("PRECONDITION_FAILED", { key: "Client.Settings.Security.errorRegisterFailed" });
      }
    }, RATE_LIMITS.SETTINGS);
  });

export const deletePasskeyAction = actionClient
  .inputSchema(deletePasskeySchema)
  .action(async ({ parsedInput: input }) => {
    return withUserRateLimit(async () => {
      const session = await requireVerifiedEmail();
      const userId = session?.user?.id;

      if (!userId) {
        throw new ActionError("NOT_AUTHORIZED", { key: "Client.Errors.notAuthenticated" });
      }

      // Prevent deletion of the current passkey
      if (session?.passkeyCredentialId === input.credentialId) {
        throw new ActionError("FORBIDDEN", { key: "Client.Settings.Security.errorDeleteCurrentPasskey" });
      }

      const db = getDB();

      const passkey = await db.query.passKeyCredentialTable.findFirst({
        where: {
          credentialId: input.credentialId,
          userId,
        },
      });

      if (!passkey) {
        throw new ActionError("NOT_FOUND", { key: "Client.Settings.Security.errorPasskeyNotFound" });
      }

      const passkeys = await db
        .select()
        .from(passKeyCredentialTable)
        .where(eq(passKeyCredentialTable.userId, userId));

      const user = await db.query.userTable.findFirst({
        where: { id: userId },
      });

      if (!user) {
        throw new ActionError("NOT_FOUND", { key: "Client.Errors.userNotFound" });
      }

      if (passkeys.length === 1 && !user.passwordHash) {
        throw new ActionError("FORBIDDEN", { key: "Client.Settings.Security.errorDeleteLastPasskey" });
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
      await storeWebAuthnChallenge({
        challenge: options.challenge,
        purpose: WEBAUTHN_CHALLENGE_PURPOSE.AUTHENTICATION,
      });
      const secure = await shouldUseSecureCookies();

      cookieStore.set(PASSKEY_AUTHENTICATION_CHALLENGE_COOKIE_NAME, options.challenge, {
        httpOnly: true,
        secure,
        sameSite: "strict",
        path: "/",
        maxAge: WEBAUTHN_CHALLENGE_TTL_SECONDS,
      });

      return options;
    }, RATE_LIMITS.SIGN_IN);
  });

export const verifyAuthenticationAction = actionClient
  .inputSchema(verifyAuthenticationSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(async () => {
      const cookieStore = await cookies();
      const challenge = cookieStore.get(PASSKEY_AUTHENTICATION_CHALLENGE_COOKIE_NAME)?.value;

      if (!challenge) {
        throw new ActionError("PRECONDITION_FAILED", { key: "Client.Settings.Security.errorInvalidAuthSession" });
      }

      cookieStore.delete(PASSKEY_AUTHENTICATION_CHALLENGE_COOKIE_NAME);

      const challengePayload = await consumeWebAuthnChallenge({
        challenge,
        purpose: WEBAUTHN_CHALLENGE_PURPOSE.AUTHENTICATION,
      });

      if (!challengePayload) {
        throw new ActionError("PRECONDITION_FAILED", { key: "Client.Settings.Security.errorInvalidAuthSession" });
      }

      try {
        const { verification, credential } = await verifyPasskeyAuthentication({
          response: input.response,
          challenge,
        });

        if (!verification.verified) {
          throw new ActionError("FORBIDDEN", { key: "Client.Settings.Security.errorAuthFailed" });
        }

        await createAndStoreSession(credential.userId, "passkey", input.response.id);
        return { success: true };
      } catch (error) {
        if (error instanceof ActionError) {
          throw error;
        }

        throw new ActionError("FORBIDDEN", { key: "Client.Settings.Security.errorAuthFailed" });
      }
    }, RATE_LIMITS.SIGN_IN);
  });
