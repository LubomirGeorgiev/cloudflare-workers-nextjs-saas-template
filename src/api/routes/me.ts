import "server-only";

import { Hono } from "hono";

import { toIsoString, toNullableIsoString } from "@/utils/iso-timestamp";
import { apiValidator } from "@/api/middleware/problem-json";
import { apiOperation } from "@/api/operation";
import { API_TAGS } from "@/api/openapi-document";
import { jsonResponse } from "@/api/openapi";
import type { ApiEnv } from "@/api/types";
import { getUserSessions, revokeUserSession } from "@/lib/account/sessions";
import { updateUserProfile } from "@/lib/account/profile";
import type { v } from "@/lib/validation";
import {
  meSchema,
  sessionIdParamSchema,
  sessionListSchema,
  type sessionSchema,
} from "@/schemas/api/me.schema";
import { successSchema } from "@/schemas/api/common.schema";
import { userSettingsSchema } from "@/schemas/settings.schema";
import type { SessionWithMeta } from "@/types";
import type { KVSession } from "@/utils/kv-session";
import { requireVerifiedEmail } from "@/utils/auth";

// Typed against the documented schema: a field renamed on one side without the other is a
// compile error, not a wrong public document that still passes CI.
function toMeDto(user: KVSession["user"]): v.InferOutput<typeof meSchema> {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    role: user.role,
    avatar: user.avatar ?? null,
    preferredLocale: user.preferredLocale ?? null,
    emailVerified: toNullableIsoString(user.emailVerified),
    createdAt: toIsoString(user.createdAt),
    updatedAt: toIsoString(user.updatedAt),
  };
}

// Deliberately narrow: enough to recognize a device in a list, nothing that would help an
// attacker fingerprint one. The raw user-agent and IP stay server-side.
function toSessionDto(session: SessionWithMeta): v.InferOutput<typeof sessionSchema> {
  return {
    id: session.id,
    createdAt: toIsoString(session.createdAt),
    expiresAt: toIsoString(session.expiration ?? session.expiresAt),
    isCurrentSession: session.isCurrentSession,
    authenticationType: session.authenticationType ?? null,
    country: session.country ?? null,
    city: session.city ?? null,
    browser: session.parsedUserAgent?.browser?.name ?? null,
    os: session.parsedUserAgent?.os?.name ?? null,
    deviceType: session.parsedUserAgent?.device?.type ?? null,
  };
}

export const meRoutes = new Hono<ApiEnv>()
  .get(
    "/me",
    ...apiOperation({
      operationId: "getMe",
      tags: [API_TAGS.account],
      summary: "Get the authenticated account",
      description:
        "Returns the profile of the account the credential belongs to: id, email, name, role, " +
        "avatar, preferred locale, and verification/creation timestamps. " +
        "Account-level: a team-scoped API key is refused with 403.",
      scope: "profile:read",
      audience: "account",
      responses: {
        200: jsonResponse({ description: "The authenticated account.", schema: meSchema }),
      },
    }),
    async (c) => {
      const session = await requireVerifiedEmail();

      return c.json(toMeDto(session.user));
    },
  )
  .patch(
    "/me",
    ...apiOperation({
      operationId: "updateMe",
      tags: [API_TAGS.account],
      summary: "Update the authenticated account",
      description:
        "Updates the first and last name of the authenticated account. Both fields are required; " +
        "the response is the account as it stands after the update. " +
        "Account-level: a team-scoped API key is refused with 403.",
      scope: "profile:write",
      audience: "account",
      responses: {
        200: jsonResponse({ description: "The updated account.", schema: meSchema }),
      },
    }),
    apiValidator("json", userSettingsSchema),
    async (c) => {
      const input = c.req.valid("json");

      const { user } = await updateUserProfile(input);

      return c.json(toMeDto(user));
    },
  )
  .get(
    "/me/sessions",
    ...apiOperation({
      operationId: "listMySessions",
      tags: [API_TAGS.account],
      summary: "List sign-in sessions",
      description:
        "Lists the account's active browser/app sign-in sessions, newest first, with the device " +
        "and location recorded at sign-in. `isCurrentSession` is false for every bearer credential. " +
        "Account-level: a team-scoped API key is refused with 403.",
      scope: "profile:read",
      audience: "account",
      responses: {
        200: jsonResponse({ description: "The account's sessions.", schema: sessionListSchema }),
      },
    }),
    async (c) => {
      const sessions = await getUserSessions();

      return c.json(sessions.map(toSessionDto));
    },
  )
  .delete(
    "/me/sessions/:sessionId",
    ...apiOperation({
      operationId: "revokeMySession",
      tags: [API_TAGS.account],
      summary: "Revoke a sign-in session",
      description:
        "Signs the account out of one session. Revocation is scoped to the caller's own sessions, " +
        "so an unknown session id is a no-op rather than an error. " +
        "Account-level: a team-scoped API key is refused with 403.",
      scope: "profile:write",
      audience: "account",
      responses: {
        200: jsonResponse({ description: "The session was revoked.", schema: successSchema }),
      },
    }),
    apiValidator("param", sessionIdParamSchema),
    async (c) => {
      const { sessionId } = c.req.valid("param");

      return c.json(await revokeUserSession({ sessionId }));
    },
  );
