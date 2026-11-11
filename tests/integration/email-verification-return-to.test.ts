/// <reference types="@cloudflare/vitest-plugin/types" />

// The verification token carries the page a sign-up came from, so the verify link can send the
// user back there. These tests run the real actions against Miniflare D1 and KV.
//
// Mocked: the request (cookies, headers), the rate limiter, translations, and the email queue.

import { beforeEach, describe, expect, test, vi } from "vitest";

const { cookieJar, sentTokens } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  sentTokens: [] as string[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);

      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (cookie: string | { name: string }) => {
      cookieJar.delete(typeof cookie === "string" ? cookie : cookie.name);
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
  isTurnstileEnabled: async () => false,
}));

// The token is only in the email, so the queue write is where the test reads it.
vi.mock("@/utils/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/email")>()),
  sendVerificationEmail: async ({ verificationToken }: { verificationToken: string }) => {
    sentTokens.push(verificationToken);
  },
}));

vi.mock("@/lib/cms/cms-author-cache-invalidation", () => ({
  invalidateCmsAuthorAfterUserWrite: async () => undefined,
}));

vi.mock("@/utils/run-in-background", () => ({ runInBackground: () => undefined }));

import { env } from "cloudflare:workers";

import { EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS, REDIRECT_AFTER_SIGN_IN, TEAM_INVITE_PATH } from "@/constants";
import { getDB } from "@/db";
import { sendVerificationAction } from "@/app/[locale]/(auth)/send-verification.action";
import { signUpAction } from "@/app/[locale]/(auth)/sign-up/sign-up.actions";
import { verifyEmailAction } from "@/app/[locale]/(auth)/verify-email/verify-email.action";
import { getVerificationTokenKey } from "@/utils/auth-utils";
import type { EmailVerificationTokenPayload } from "@/utils/email-verification";
import { createExpiringToken, readExpiringToken } from "@/utils/kv-token";

const INVITE_RETURN_PATH = `${TEAM_INVITE_PATH}?token=invite-token`;
const UNSAFE_RETURN_PATHS = ["//evil.example", "https://other.example/x"];

const db = getDB();
let emailSequence = 0;

beforeEach(async () => {
  await env.D1_DB.batch([
    env.D1_DB.prepare("DELETE FROM passkey_credential"),
    env.D1_DB.prepare("DELETE FROM user"),
  ]);

  const keys = await env.KV_STORE.list();
  await Promise.all(keys.keys.map((key) => env.KV_STORE.delete(key.name)));

  cookieJar.clear();
  sentTokens.length = 0;
});

describe("the return path of the verification link", () => {
  test("sign-up saves the return path, and verify returns it", async () => {
    const token = await signUpAndGetToken(INVITE_RETURN_PATH);

    expect((await readTokenPayload(token)).returnTo).toBe(INVITE_RETURN_PATH);

    const result = await verifyEmailAction({ token });

    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.returnTo).toBe(INVITE_RETURN_PATH);
  });

  test("a token without a return path returns the default", async () => {
    const userId = await signUpAndGetUserId(undefined);
    const token = await createExpiringToken({
      key: getVerificationTokenKey,
      expiresInSeconds: EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS,
      payload: { userId },
    });

    const result = await verifyEmailAction({ token });

    expect(result?.data?.returnTo).toBe(REDIRECT_AFTER_SIGN_IN);
  });

  test.each(UNSAFE_RETURN_PATHS)("sign-up saves the default in place of %s", async (unsafePath) => {
    const token = await signUpAndGetToken(unsafePath);

    expect((await readTokenPayload(token)).returnTo).toBe(REDIRECT_AFTER_SIGN_IN);
    expect((await verifyEmailAction({ token }))?.data?.returnTo).toBe(REDIRECT_AFTER_SIGN_IN);
  });

  test.each(UNSAFE_RETURN_PATHS)("verify returns the default for a stored %s", async (unsafePath) => {
    const userId = await signUpAndGetUserId(undefined);
    const token = await createExpiringToken<EmailVerificationTokenPayload>({
      key: getVerificationTokenKey,
      expiresInSeconds: EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS,
      payload: { userId, returnTo: unsafePath },
    });

    expect((await verifyEmailAction({ token }))?.data?.returnTo).toBe(REDIRECT_AFTER_SIGN_IN);
  });

  test("a resend saves the page path it was sent from", async () => {
    await signUpAndGetUserId(undefined);
    sentTokens.length = 0;

    const result = await sendVerificationAction({ returnTo: INVITE_RETURN_PATH });

    expect(result?.serverError).toBeUndefined();
    expect(sentTokens).toHaveLength(1);
    expect((await readTokenPayload(sentTokens[0])).returnTo).toBe(INVITE_RETURN_PATH);
  });

  test("a resend with an unsafe path saves the default", async () => {
    await signUpAndGetUserId(undefined);
    sentTokens.length = 0;

    await sendVerificationAction({ returnTo: UNSAFE_RETURN_PATHS[0] });

    expect((await readTokenPayload(sentTokens[0])).returnTo).toBe(REDIRECT_AFTER_SIGN_IN);
  });
});

async function signUpAndGetToken(returnTo: string | undefined): Promise<string> {
  await signUpAndGetUserId(returnTo);

  expect(sentTokens).toHaveLength(1);

  return sentTokens[0];
}

async function signUpAndGetUserId(returnTo: string | undefined): Promise<string> {
  emailSequence += 1;
  const email = `return-to-${emailSequence}@example.com`;
  const result = await signUpAction({
    email,
    firstName: "Return",
    lastName: "Path",
    password: "correct horse battery staple",
    returnTo,
  });

  expect(result?.serverError).toBeUndefined();

  const user = await db.query.userTable.findFirst({ where: { email } });

  if (!user) {
    throw new Error("The sign-up did not create the user row");
  }

  return user.id;
}

async function readTokenPayload(token: string): Promise<EmailVerificationTokenPayload> {
  const result = await readExpiringToken<EmailVerificationTokenPayload>({
    token,
    key: getVerificationTokenKey,
  });

  if (result.status !== "valid") {
    throw new Error(`The verification token is ${result.status}`);
  }

  return result.payload;
}
