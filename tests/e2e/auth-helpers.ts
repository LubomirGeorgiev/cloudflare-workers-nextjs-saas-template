import {
  clickAppRole,
  expectAppPathname,
  expectNoAppToast,
  fillAppPlaceholder,
  loadAppFrame,
} from "./app-frame";
import { queryLocalD1, sqlStringLiteral } from "./local-wrangler-state";
import { NAME_MIN_LENGTH } from "../../src/constants";
import { DEFAULT_LOCALE, ENABLED_LOCALES } from "../../src/i18n/config";
import { loadCatalog } from "../../src/i18n/message-catalogs";
import { getTranslator } from "../../src/i18n/translator";

export const SEEDED_ADMIN_EMAIL = "test@test.com";
export const SEEDED_MEMBER_EMAIL = "sarah.chen@example.com";
// Every seeded account shares this password (see `src/db/seed.sql`); one home so a reseed
// with different credentials is a single edit.
export const SEEDED_USER_PASSWORD = "password";
// A page with no locale prefix renders in the default locale, so its copy comes from that catalog.
export const DEFAULT_MESSAGES = await loadCatalog(DEFAULT_LOCALE);
export const AUTH_COPY = DEFAULT_MESSAGES.Client.Auth;
const formatValidationMessage = await getTranslator({
  locale: DEFAULT_LOCALE,
  namespace: "Client.Validation",
});
export const NAME_MIN_LENGTH_MESSAGE = formatValidationMessage("minLength", { min: NAME_MIN_LENGTH });
// Derived from the served set, so a fork with other locales, or with i18n off, still passes.
export const NON_DEFAULT_LOCALE = ENABLED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE);

interface CreateVerifiedUserInLocalD1Params {
  email: string;
  firstName?: string;
  idPrefix?: string;
  lastName?: string;
  preferredLocale?: string | null;
  role?: "admin" | "user";
}

export async function createVerifiedUserInLocalD1({
  email,
  firstName = "Verified",
  idPrefix = "usr_e2e",
  lastName = "Account",
  preferredLocale = null,
  role = "user",
}: CreateVerifiedUserInLocalD1Params): Promise<void> {
  const passwordHash = await queryLocalD1({
    sql: "select passwordHash from user where passwordHash is not null limit 1;",
  });

  if (!passwordHash) {
    throw new Error("Expected seeded D1 state to include a reusable password hash.");
  }

  const now = Math.floor(Date.now() / 1_000);
  const userId = `${idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await queryLocalD1({
    sql: `
      insert into user (
        id,
        createdAt,
        updatedAt,
        updateCounter,
        firstName,
        lastName,
        email,
        passwordHash,
        role,
        emailVerified,
        signUpIpAddress,
        googleAccountId,
        avatar,
        preferredLocale
      )
      values (
        ${sqlStringLiteral(userId)},
        ${now},
        ${now},
        0,
        ${sqlStringLiteral(firstName)},
        ${sqlStringLiteral(lastName)},
        ${sqlStringLiteral(email)},
        ${sqlStringLiteral(passwordHash)},
        ${sqlStringLiteral(role)},
        ${now},
        '127.0.0.1',
        null,
        null,
        ${preferredLocale === null ? "null" : sqlStringLiteral(preferredLocale)}
      );
    `,
  });
}

interface SignInWithPasswordParams {
  email: string;
  password: string;
  redirectPath?: string;
  expectedPathname?: string;
}

export async function signInWithPassword({
  email,
  password,
  redirectPath = "/dashboard",
  expectedPathname = redirectPath,
}: SignInWithPasswordParams): Promise<void> {
  await loadAppFrame(`/sign-in?redirect=${encodeURIComponent(redirectPath)}`, {
    waitForHydration: true,
  });

  await fillAppPlaceholder(AUTH_COPY.Common.emailPlaceholder, email);
  await fillAppPlaceholder(AUTH_COPY.Common.passwordPlaceholder, password);
  await clickAppRole("button", AUTH_COPY.SignIn.signInWithPassword);
  await expectAppPathname(expectedPathname);
  await expectNoAppToast(AUTH_COPY.SignIn.toastSigningIn);
}

export function signInSeededMember(
  redirectPath = "/dashboard",
  expectedPathname = redirectPath
): Promise<void> {
  return signInWithPassword({
    email: SEEDED_MEMBER_EMAIL,
    password: SEEDED_USER_PASSWORD,
    redirectPath,
    expectedPathname,
  });
}

export function passwordMinLengthMessage(min: number) {
  return formatValidationMessage("passwordMinLength", { min });
}

// Validation limits are template-configurable, so drive the "too short" inputs off the
// constant instead of literals that silently stop being too short.
export function tooShort(min: number) {
  return "a".repeat(min - 1);
}
