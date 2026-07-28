import {
  clickAppRole,
  expectAppPathname,
  expectNoAppToast,
  fillAppPlaceholder,
  loadAppFrame,
} from "./app-frame";
import { queryLocalD1, sqlStringLiteral } from "./local-wrangler-state";

export const SEEDED_ADMIN_EMAIL = "test@test.com";
export const SEEDED_MEMBER_EMAIL = "sarah.chen@example.com";
// Every seeded account shares this password (see `src/db/seed.sql`); one home so a reseed
// with different credentials is a single edit.
export const SEEDED_USER_PASSWORD = "password";

interface CreateVerifiedUserInLocalD1Params {
  email: string;
  firstName?: string;
  idPrefix?: string;
  lastName?: string;
  role?: "admin" | "user";
}

export async function createVerifiedUserInLocalD1({
  email,
  firstName = "Verified",
  idPrefix = "usr_e2e",
  lastName = "Account",
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
        avatar
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
        null
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

  await fillAppPlaceholder("Email address", email);
  await fillAppPlaceholder("Password", password);
  await clickAppRole("button", "Sign In with Password");
  await expectAppPathname(expectedPathname);
  await expectNoAppToast("Signing you in...");
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
