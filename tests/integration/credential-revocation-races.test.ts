/// <reference types="@cloudflare/vitest-plugin/types" />

// A revoke only works when nothing written during it survives. These tests run the real actions
// against Miniflare D1 and KV, and run a Google reclaim or a password change at the exact point
// where a sign-in has checked the credential but not yet written its session.
//
// Mocked: the request (cookies, headers), the Google code exchange, the WebAuthn signature check,
// the rate limiter, and translations. The account rows, sessions, and challenges are real.

import { beforeEach, describe, expect, test, vi } from "vitest";

const { browser, hooks } = vi.hoisted(() => {
  // One cookie jar per browser, so the attacker and the victim never share a cookie.
  const browser: { current: "attacker" | "victim"; jars: Record<"attacker" | "victim", Map<string, string>> } = {
    current: "attacker",
    jars: { attacker: new Map(), victim: new Map() },
  };
  // Runs inside an action at the point where a race can land.
  const hooks: Record<
    "afterPasskeyVerified" | "afterPasswordVerified" | "beforeSignUpSession",
    null | (() => Promise<void>)
  > = {
    afterPasskeyVerified: null,
    afterPasswordVerified: null,
    beforeSignUpSession: null,
  };

  return { browser, hooks };
});

function currentJar(): Map<string, string> {
  return browser.jars[browser.current];
}

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = currentJar().get(name);

      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      currentJar().set(name, value);
    },
    delete: (cookie: string | { name: string }) => {
      currentJar().delete(typeof cookie === "string" ? cookie : cookie.name);
    },
  }),
  headers: async () => new Headers({ "user-agent": "integration-test" }),
}));

vi.mock("@/i18n/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/i18n/new-account-locale", async () => {
  const { DEFAULT_LOCALE } = await import("@/i18n/config");

  return { getNewAccountLocale: async () => DEFAULT_LOCALE };
});

vi.mock("@/utils/with-rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/with-rate-limit")>()),
  withRateLimit: async (action: () => Promise<unknown>) => action(),
}));

vi.mock("@/flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/flags")>()),
  isGoogleSSOEnabled: async () => true,
  isTurnstileEnabled: async () => false,
}));

vi.mock("@/lib/sso/google-sso", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sso/google-sso")>()),
  validateGoogleAuthorizationCode: async () => "id-token",
  parseGoogleIdToken: () => ({
    sub: GOOGLE_SUB,
    email: VICTIM_EMAIL,
    email_verified: true,
    given_name: "Victim",
  }),
}));

vi.mock("@simplewebauthn/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@simplewebauthn/server")>()),
  verifyRegistrationResponse: async ({ response }: { response: { id: string } }) => ({
    verified: true,
    registrationInfo: {
      credential: { id: response.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
      aaguid: "test-aaguid",
    },
  }),
  verifyAuthenticationResponse: async () => {
    await hooks.afterPasskeyVerified?.();

    return { verified: true, authenticationInfo: { newCounter: 1 } };
  },
}));

// Called after the passkey insert and before the session write, so it marks the race point.
vi.mock("@/utils/email-verification", () => ({
  sendUserVerificationEmail: async () => {
    await hooks.beforeSignUpSession?.();
  },
}));

vi.mock("@/utils/password-hasher", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/utils/password-hasher")>();

  return {
    ...original,
    verifyPassword: async (params: Parameters<typeof original.verifyPassword>[0]) => {
      const result = await original.verifyPassword(params);

      if (result.isValid) {
        await hooks.afterPasswordVerified?.();
      }

      return result;
    },
  };
});

vi.mock("@/lib/cms/cms-author-cache-invalidation", () => ({
  invalidateCmsAuthorAfterUserWrite: async () => undefined,
}));

vi.mock("@/utils/run-in-background", () => ({ runInBackground: () => undefined }));

import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

import { getDB } from "@/db";
import { passKeyCredentialTable, userTable } from "@/db/schema";
import {
  GOOGLE_OAUTH_CODE_VERIFIER_COOKIE_NAME,
  GOOGLE_OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "@/constants";
import { googleSSOCallbackAction } from "@/app/[locale]/(auth)/sso/google/callback/google-callback.action";
import {
  completePasskeyRegistrationAction,
  startPasskeyRegistrationAction,
} from "@/app/[locale]/(auth)/sign-up/passkey-sign-up.actions";
import { signInWithPassword } from "@/app/[locale]/(auth)/sign-in/sign-in-auth";
import {
  generateAuthenticationOptionsAction,
  verifyAuthenticationAction,
} from "@/app/[locale]/(app)/(settings)/settings/security/passkey-settings.actions";
import { deleteAllSessionsOfUser, getAllSessionIdsOfUser } from "@/utils/kv-session";
import { hashPassword } from "@/utils/password-hasher";

const VICTIM_EMAIL = "victim@example.com";
const GOOGLE_SUB = "google-sub-victim";
const OAUTH_STATE = "oauth-state-1";
const ATTACKER_PASSWORD = "Attacker-password-1!";
const REGISTRATION_RESPONSE: RegistrationResponseJSON = {
  id: "attacker-credential",
  rawId: "attacker-credential",
  response: { attestationObject: "attestation", clientDataJSON: "client-data" },
  clientExtensionResults: {},
  type: "public-key",
};
const AUTHENTICATION_RESPONSE: AuthenticationResponseJSON = {
  id: REGISTRATION_RESPONSE.id,
  rawId: REGISTRATION_RESPONSE.rawId,
  response: { authenticatorData: "auth-data", clientDataJSON: "client-data", signature: "signature" },
  clientExtensionResults: {},
  type: "public-key",
};

const db = getDB();

beforeEach(async () => {
  await env.D1_DB.batch([
    env.D1_DB.prepare("DELETE FROM passkey_credential"),
    env.D1_DB.prepare("DELETE FROM user"),
  ]);

  const keys = await env.KV_STORE.list();
  await Promise.all(keys.keys.map((key) => env.KV_STORE.delete(key.name)));

  browser.current = "attacker";
  browser.jars.attacker.clear();
  browser.jars.victim.clear();
  hooks.afterPasskeyVerified = null;
  hooks.afterPasswordVerified = null;
  hooks.beforeSignUpSession = null;
});

describe("passkey sign-up after a Google reclaim", () => {
  test("refuses a sign-up that completes after the reclaim", async () => {
    const userId = await startAttackerSignUp();

    await asVictim(signInWithGoogle);

    const result = await completePasskeyRegistrationAction({ response: REGISTRATION_RESPONSE });

    expect(result?.serverError?.reason).toBe("Client.Auth.SignUp.errorRegisterFailed");
    await expectOnlyVictimHoldsTheAccount(userId);
  });

  test("rolls back the session of a sign-up whose insert landed before the reclaim", async () => {
    const userId = await startAttackerSignUp();
    hooks.beforeSignUpSession = () => asVictim(signInWithGoogle);

    const result = await completePasskeyRegistrationAction({ response: REGISTRATION_RESPONSE });

    expect(result?.serverError?.reason).toBe("Client.Auth.SignUp.errorRegisterFailed");
    await expectOnlyVictimHoldsTheAccount(userId);
  });

  test("still completes a sign-up nobody claimed", async () => {
    const userId = await startAttackerSignUp();

    const result = await completePasskeyRegistrationAction({ response: REGISTRATION_RESPONSE });

    expect(result?.serverError).toBeUndefined();
    expect(await credentialIdsOf(userId)).toEqual([REGISTRATION_RESPONSE.id]);
    expect(await getAllSessionIdsOfUser(userId)).toHaveLength(1);
    expect(browser.jars.attacker.has(SESSION_COOKIE_NAME)).toBe(true);
  });
});

describe("password sign-in that overlaps a credential change", () => {
  test("rolls back the session when a reset changes the hash after the password verified", async () => {
    const userId = await seedPasswordUser({ emailVerified: new Date() });
    // The reset action's order: write the new hash, then revoke every session.
    hooks.afterPasswordVerified = async () => {
      await db.update(userTable)
        .set({ passwordHash: await hashPassword({ password: "Victim-new-password-1!" }) })
        .where(eq(userTable.id, userId));
      await deleteAllSessionsOfUser(userId);
    };

    await expect(signInWithPassword({ email: VICTIM_EMAIL, password: ATTACKER_PASSWORD }))
      .rejects.toMatchObject({ code: "NOT_AUTHORIZED", messageKey: "Client.Auth.SignIn.errorInvalidCredentials" });

    expect(await getAllSessionIdsOfUser(userId)).toHaveLength(0);
    expect(browser.jars.attacker.has(SESSION_COOKIE_NAME)).toBe(false);
  });

  test("rolls back the session when a Google reclaim clears the hash after the password verified", async () => {
    const userId = await seedPasswordUser({ emailVerified: null });
    hooks.afterPasswordVerified = async () => {
      hooks.afterPasswordVerified = null;
      await asVictim(signInWithGoogle);
    };

    await expect(signInWithPassword({ email: VICTIM_EMAIL, password: ATTACKER_PASSWORD }))
      .rejects.toMatchObject({ code: "NOT_AUTHORIZED", messageKey: "Client.Auth.SignIn.errorInvalidCredentials" });

    expect(browser.jars.attacker.has(SESSION_COOKIE_NAME)).toBe(false);
    expect(await getAllSessionIdsOfUser(userId)).toHaveLength(1);
    expect(browser.jars.victim.has(SESSION_COOKIE_NAME)).toBe(true);
  });

  test("keeps the session when the hash did not change", async () => {
    const userId = await seedPasswordUser({ emailVerified: new Date() });

    await expect(signInWithPassword({ email: VICTIM_EMAIL, password: ATTACKER_PASSWORD }))
      .resolves.toMatchObject({ success: true });

    expect(await getAllSessionIdsOfUser(userId)).toHaveLength(1);
  });
});

describe("passkey sign-in that overlaps a Google reclaim", () => {
  test("rolls back the session when the reclaim removes the passkey after it verified", async () => {
    const userId = await completeAttackerSignUp();
    hooks.afterPasskeyVerified = async () => {
      hooks.afterPasskeyVerified = null;
      await asVictim(signInWithGoogle);
    };

    const result = await signInWithPasskey();

    expect(result?.serverError?.reason).toBe("Client.Settings.Security.errorAuthFailed");
    await expectOnlyVictimHoldsTheAccount(userId);
  });

  test("keeps the session when the passkey is still there", async () => {
    const userId = await completeAttackerSignUp();

    const result = await signInWithPasskey();

    expect(result?.serverError).toBeUndefined();
    expect(await getAllSessionIdsOfUser(userId)).toHaveLength(1);
    expect(browser.jars.attacker.has(SESSION_COOKIE_NAME)).toBe(true);
  });
});

// The sign-up leaves a passkey and a session; the session goes, so only the passkey remains.
async function completeAttackerSignUp(): Promise<string> {
  const userId = await startAttackerSignUp();
  const completed = await completePasskeyRegistrationAction({ response: REGISTRATION_RESPONSE });
  expect(completed?.serverError).toBeUndefined();

  await deleteAllSessionsOfUser(userId);
  browser.jars.attacker.clear();

  return userId;
}

async function signInWithPasskey() {
  const options = await generateAuthenticationOptionsAction();
  expect(options?.serverError).toBeUndefined();

  return verifyAuthenticationAction({ response: AUTHENTICATION_RESPONSE });
}

async function startAttackerSignUp(): Promise<string> {
  const started = await startPasskeyRegistrationAction({
    email: VICTIM_EMAIL,
    firstName: "Mallory",
    lastName: "Attacker",
  });
  expect(started?.serverError).toBeUndefined();

  const user = await db.query.userTable.findFirst({ where: { email: VICTIM_EMAIL } });

  if (!user) {
    throw new Error("The sign-up start did not create the user row");
  }

  expect(user.emailVerified).toBeNull();

  return user.id;
}

async function signInWithGoogle(): Promise<void> {
  browser.jars.victim.set(GOOGLE_OAUTH_STATE_COOKIE_NAME, OAUTH_STATE);
  browser.jars.victim.set(GOOGLE_OAUTH_CODE_VERIFIER_COOKIE_NAME, "code-verifier");

  const result = await googleSSOCallbackAction({ code: "auth-code", state: OAUTH_STATE });

  expect(result?.serverError).toBeUndefined();
}

async function asVictim(run: () => Promise<void>): Promise<void> {
  const previous = browser.current;
  browser.current = "victim";

  try {
    await run();
  } finally {
    browser.current = previous;
  }
}

async function seedPasswordUser({ emailVerified }: { emailVerified: Date | null }): Promise<string> {
  const [user] = await db.insert(userTable).values({
    email: VICTIM_EMAIL,
    emailVerified,
    passwordHash: await hashPassword({ password: ATTACKER_PASSWORD }),
  }).returning({ id: userTable.id });

  return user.id;
}

async function credentialIdsOf(userId: string): Promise<string[]> {
  const rows = await db.select({ credentialId: passKeyCredentialTable.credentialId })
    .from(passKeyCredentialTable)
    .where(eq(passKeyCredentialTable.userId, userId));

  return rows.map((row) => row.credentialId);
}

// The victim's Google session is the only one, and the attacker has no credential and no cookie.
async function expectOnlyVictimHoldsTheAccount(userId: string): Promise<void> {
  const user = await db.query.userTable.findFirst({ where: { id: userId } });

  expect(user?.googleAccountId).toBe(GOOGLE_SUB);
  expect(user?.emailVerified).not.toBeNull();
  expect(await credentialIdsOf(userId)).toEqual([]);
  expect(browser.jars.attacker.has(SESSION_COOKIE_NAME)).toBe(false);
  expect(await getAllSessionIdsOfUser(userId)).toHaveLength(1);
  expect(browser.jars.victim.has(SESSION_COOKIE_NAME)).toBe(true);
}
