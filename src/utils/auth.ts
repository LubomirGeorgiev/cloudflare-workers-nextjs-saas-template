import "server-only";

import ms from "ms"
import { cookies } from "next/headers";
import { isLocalhost } from "@/utils/is-local";
import {
  createKVSession,
  deleteKVSession,
  type KVSession,
  type CreateKVSessionParams,
  getKVSession,
  updateKVSession,
  CURRENT_SESSION_VERSION
} from "./kv-session";
import { cache } from "react"
import type { CookieSession, CurrentSession, SessionValidationResult } from "@/types";
import {
  AUTH_SESSION_PRESENT_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "@/constants";
import { ActionError } from "@/lib/action-error";
import { assertNotBanned, isBanned } from "@/lib/account/ban";
import { getBearerPrincipal, principalToSession } from "@/lib/api/principal";
import { touchUserLastActiveAt } from "@/utils/user-activity";
import { getInitials } from "./name-initials";
import { ROLES_ENUM } from "@/app/enums";
import { getUserBannedAt, getUserFromDB, getUserTeamsWithPermissions } from "@/utils/session-user";
import { createBase64UrlToken, hashToken } from "@/utils/random-token";
import { shouldUseSecureCookies } from "./cookie-security";

const SESSION_TOKEN_BYTES = 48;

const getSessionLength = () => {
  return ms("30d");
}

/**
 * This file is based on https://lucia-auth.com
 */

export function generateSessionToken(): string {
  return createBase64UrlToken(SESSION_TOKEN_BYTES);
}

// Session id = SHA-256 hex of the raw token. Delegates to the canonical hashToken helper
// (same lowercase-hex derivation as before) so a KV read never exposes a usable session token.
async function generateSessionId(token: string): Promise<string> {
  return hashToken(token);
}

function encodeSessionCookie(userId: string, token: string): string {
  return `${userId}:${token}`;
}

function decodeSessionCookie(cookie: string): { userId: string; token: string } | null {
  const parts = cookie.split(':');
  if (parts.length !== 2) {
    return null;
  }
  return { userId: parts[0], token: parts[1] };
}

interface CreateSessionParams extends Pick<CreateKVSessionParams, "authenticationType" | "passkeyCredentialId" | "userId"> {
  token: string;
}

async function createSession({
  token,
  userId,
  authenticationType,
  passkeyCredentialId
}: CreateSessionParams): Promise<KVSession> {
  const sessionId = await generateSessionId(token);
  const expiresAt = new Date(Date.now() + getSessionLength());

  const user = await getUserFromDB(userId);

  if (!user) {
    throw new Error("User not found");
  }

  const teamsWithPermissions = await getUserTeamsWithPermissions(userId);

  const session = await createKVSession({
    sessionId,
    userId,
    expiresAt,
    user,
    authenticationType,
    passkeyCredentialId,
    teams: teamsWithPermissions,
    selectedTeam: teamsWithPermissions?.length > 0 ? teamsWithPermissions?.[0]?.id : undefined
  });

  return session;
}

export async function createAndStoreSession(
  userId: string,
  authenticationType?: CreateKVSessionParams["authenticationType"],
  passkeyCredentialId?: CreateKVSessionParams["passkeyCredentialId"]
) {
  const sessionToken = generateSessionToken();
  const session = await createSession({
    token: sessionToken,
    userId,
    authenticationType,
    passkeyCredentialId
  });
  await setSessionTokenCookie({
    token: sessionToken,
    userId,
    expiresAt: new Date(session.expiresAt)
  });
}

interface CreateSessionUnlessBannedParams {
  userId: string;
  authenticationType?: CreateKVSessionParams["authenticationType"];
  passkeyCredentialId?: CreateKVSessionParams["passkeyCredentialId"];
}

/**
 * The session write for every sign-in chokepoint that has already checked the ban.
 *
 * A ban landing between that check and this write would leave a current-version session that the
 * ban's key listing had already passed: nothing rebuilds it from D1, so it would authenticate
 * until it expired. Re-read the flag, roll the session back, and refuse with the same error.
 */
export async function createSessionUnlessBanned({
  userId,
  authenticationType,
  passkeyCredentialId,
}: CreateSessionUnlessBannedParams): Promise<void> {
  const sessionToken = generateSessionToken();
  const session = await createSession({
    token: sessionToken,
    userId,
    authenticationType,
    passkeyCredentialId,
  });

  const bannedAt = await getUserBannedAt(userId);

  if (isBanned({ bannedAt })) {
    await deleteKVSession(session.id, userId);
  }

  // Throws the refusal the chokepoint's own check throws, before any cookie exists to clean up.
  assertNotBanned({ bannedAt });

  await setSessionTokenCookie({
    token: sessionToken,
    userId,
    expiresAt: new Date(session.expiresAt),
  });
}

async function validateSessionToken(token: string, userId: string): Promise<KVSession | null> {
  const sessionId = await generateSessionId(token);

  const session = await getKVSession(sessionId, userId);

  if (!session) {
    return null;
  }

  // If the session has expired, delete it and return null
  if (Date.now() >= session.expiresAt) {
    await deleteKVSession(sessionId, userId);
    return null;
  }

  // Belt and braces behind the ban itself, which deletes every session of the user, and behind
  // `createSessionUnlessBanned`, which rolls back a sign-in that raced it. Neither covers a key
  // the ban's eventually-consistent KV listing missed; that session lives until it expires.
  if (isBanned(session.user)) {
    await deleteKVSession(sessionId, userId);
    return null;
  }

  if (!session.version || session.version !== CURRENT_SESSION_VERSION) {
    const updatedSession = await updateKVSession(sessionId, userId, new Date(session.expiresAt));

    if (!updatedSession) {
      return null;
    }

    // The refresh rebuilds the snapshot from D1, so the check above only tested the stale copy.
    // Without this re-test a stale-version session of a banned user authenticates one request.
    if (isBanned(updatedSession.user)) {
      await deleteKVSession(sessionId, userId);
      return null;
    }

    updatedSession.user.initials = getInitials(`${updatedSession.user.firstName} ${updatedSession.user.lastName}`);

    return updatedSession;
  }

  session.user.initials = getInitials(`${session.user.firstName} ${session.user.lastName}`);

  return session;
}

export async function invalidateSession(sessionId: string, userId: string): Promise<void> {
  await deleteKVSession(sessionId, userId);
}

interface SetSessionTokenCookieParams {
  token: string;
  userId: string;
  expiresAt: Date;
}

export async function setSessionTokenCookie({ token, userId, expiresAt }: SetSessionTokenCookieParams): Promise<void> {
  const cookieStore = await cookies();
  const secure = await shouldUseSecureCookies();
  cookieStore.set(SESSION_COOKIE_NAME, encodeSessionCookie(userId, token), {
    httpOnly: true,
    sameSite: isLocalhost ? "lax" : "strict",
    secure,
    expires: expiresAt,
    path: "/",
  });
  cookieStore.set(AUTH_SESSION_PRESENT_COOKIE_NAME, "1", {
    httpOnly: false,
    sameSite: isLocalhost ? "lax" : "strict",
    secure,
    expires: expiresAt,
    path: "/",
  });
}

export async function deleteSessionTokenCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  cookieStore.delete(AUTH_SESSION_PRESENT_COOKIE_NAME);
}

const getCookieSession = cache(async (): Promise<CookieSession | null> => {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) {
    return null;
  }

  const decoded = decodeSessionCookie(sessionCookie);

  if (!decoded || !decoded.token || !decoded.userId) {
    return null;
  }

  const session = await validateSessionToken(decoded.token, decoded.userId);

  return session && { ...session, kind: "cookie" };
})

/**
 * This function can only be called in a Server Components, Server Action or Route Handler
 */
// Bearer callers (REST API, MCP) arrive with an AsyncLocalStorage principal instead of a cookie,
// which makes every existing lib function API-callable unchanged. The lookup sits outside the
// React `cache` so a memoized cookie session can never be handed to a different principal.
export async function getCurrentSession(): Promise<SessionValidationResult | null> {
  const principal = getBearerPrincipal();

  if (principal) {
    return principalToSession(principal);
  }

  const session = await getCookieSession();

  // `lastActiveAt` tracks people, not credentials: every cookie-authenticated request flows
  // through here, so this is the one stamp site, and machine traffic is deliberately not stamped.
  if (session?.user?.id) {
    touchUserLastActiveAt(session.user.id);
  }

  return session;
}

// For session-keyed writes (rotating a selected team, revoking a device): a bearer credential has
// no KV session to act on, so the refusal is explicit rather than a silent no-op on a null `id`.
export async function requireCookieSession(): Promise<CookieSession> {
  const session = await getCurrentSession();

  if (!session) {
    throw new ActionError("NOT_AUTHORIZED", { key: "Client.Errors.notAuthenticated" });
  }

  if (session.kind !== "cookie") {
    throw new ActionError("FORBIDDEN", { key: "Client.Errors.requiresBrowserSession" });
  }

  return session;
}

interface RequireSessionOptions {
  doNotThrowError?: boolean;
}

const getRequiredVerifiedEmail = cache(async (doNotThrowError = false) => {
  const session = await getCurrentSession();

  if (!session && doNotThrowError) {
    return null;
  }

  if (!session) {
    throw new ActionError("NOT_AUTHORIZED", { key: "Client.Errors.notAuthenticated" });
  }

  if (!session?.user?.emailVerified) {
    if (doNotThrowError) {
      return null;
    }

    throw new ActionError("FORBIDDEN", { key: "Client.Errors.emailVerificationRequired" });
  }

  return session;
});

// Overloads make the nullability visible at the type level: the default (throwing) form always
// resolves to a session, so callers don't need a dead `if (!session)` guard, while the explicit
// `doNotThrowError: true` opt-out is the only form that can resolve to null.
export function requireVerifiedEmail(options: { doNotThrowError: true }): Promise<CurrentSession | null>;
export function requireVerifiedEmail(options?: { doNotThrowError?: false }): Promise<CurrentSession>;
export function requireVerifiedEmail({
  doNotThrowError = false,
}: RequireSessionOptions = {}): Promise<CurrentSession | null> {
  return getRequiredVerifiedEmail(doNotThrowError);
}

const getRequiredAdmin = cache(async (doNotThrowError = false) => {
  const session = await getCurrentSession();

  if (!session && doNotThrowError) {
    return null;
  }

  if (!session) {
    throw new ActionError("NOT_AUTHORIZED", { key: "Client.Errors.notAuthenticated" });
  }

  if (session.user.role !== ROLES_ENUM.ADMIN) {
    if (doNotThrowError) {
      return null;
    }

    throw new ActionError("FORBIDDEN", { key: "Client.Errors.notAuthorized" });
  }

  return session;
});

// Same overload pair as `requireVerifiedEmail`, and for the same reason: the default (throwing)
// form always resolves to a session, so an admin caller that needs the acting user's id does not
// have to write a dead null guard to get at it.
export function requireAdmin(options: { doNotThrowError: true }): Promise<CurrentSession | null>;
export function requireAdmin(options?: { doNotThrowError?: false }): Promise<CurrentSession>;
export function requireAdmin({
  doNotThrowError = false,
}: RequireSessionOptions = {}): Promise<CurrentSession | null> {
  return getRequiredAdmin(doNotThrowError);
}
