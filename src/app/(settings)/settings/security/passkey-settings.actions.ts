"use server";

import { z } from "zod";
import {
  generatePasskeyRegistrationOptions,
  verifyPasskeyRegistration,
  generatePasskeyAuthenticationOptions,
  verifyPasskeyAuthentication
} from "@/utils/webauthn";
import { getDB } from "@/db";
import { userTable, passKeyCredentialTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { requireVerifiedEmail, createAndStoreSession } from "@/utils/auth";
import type { User } from "@/db/schema";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/types";
import { headers } from "next/headers";
import { getIP } from "@/utils/get-IP";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";

const generateRegistrationOptionsSchema = z.object({
  email: z.string().email(),
});

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
      return options;
    }, RATE_LIMITS.SETTINGS);
  });

const verifyRegistrationSchema = z.object({
  email: z.string().email(),
  response: z.custom<RegistrationResponseJSON>(),
  challenge: z.string(),
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

      await verifyPasskeyRegistration({
        userId: user.id,
        response: input.response,
        challenge: input.challenge,
        userAgent: (await headers()).get("user-agent"),
        ipAddress: await getIP(),
      });
      await createAndStoreSession(user.id, "passkey", input.response.id);
      return { success: true };
    }, RATE_LIMITS.SETTINGS);
  });

const deletePasskeySchema = z.object({
  credentialId: z.string(),
});

export const deletePasskeyAction = actionClient
  .inputSchema(deletePasskeySchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(async () => {
      const session = await requireVerifiedEmail();

      // Prevent deletion of the current passkey
      if (session?.passkeyCredentialId === input.credentialId) {
        throw new ActionError(
          "FORBIDDEN",
          "Cannot delete the current passkey"
        );
      }

      const db = getDB();

      // Get all user's passkeys
      const passkeys = await db
        .select()
        .from(passKeyCredentialTable)
        .where(eq(passKeyCredentialTable.userId, session?.user?.id ?? ""));

      // Get full user data to check password
      const user = await db.query.userTable.findFirst({
        where: eq(userTable.id, session?.user?.id ?? ""),
      }) as User;

      // Check if this is the last passkey and if the user has a password
      if (passkeys.length === 1 && !user.passwordHash) {
        throw new ActionError(
          "FORBIDDEN",
          "Cannot delete the last passkey when no password is set"
        );
      }

      await db
        .delete(passKeyCredentialTable)
        .where(eq(passKeyCredentialTable.credentialId, input.credentialId));

      return { success: true };
    }, RATE_LIMITS.SETTINGS);
  });

export const generateAuthenticationOptionsAction = actionClient
  .inputSchema(z.object({}))
  .action(async () => {
    return withRateLimit(async () => {
      const options = await generatePasskeyAuthenticationOptions();
      return options;
    }, RATE_LIMITS.SIGN_IN);
  });

const verifyAuthenticationSchema = z.object({
  response: z.custom<AuthenticationResponseJSON>((val): val is AuthenticationResponseJSON => {
    return typeof val === "object" && val !== null && "id" in val && "rawId" in val;
  }, "Invalid authentication response"),
  challenge: z.string(),
});

export const verifyAuthenticationAction = actionClient
  .inputSchema(verifyAuthenticationSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(async () => {
      const { verification, credential } = await verifyPasskeyAuthentication(input.response, input.challenge);

      if (!verification.verified) {
        throw new ActionError("FORBIDDEN", "Passkey authentication failed");
      }

      await createAndStoreSession(credential.userId, "passkey", input.response.id);
      return { success: true };
    }, RATE_LIMITS.SIGN_IN);
  });
