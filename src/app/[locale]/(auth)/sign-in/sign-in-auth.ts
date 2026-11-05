import "server-only";

import { and, eq } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import { assertNotBanned } from "@/lib/account/ban";
import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/utils/password-hasher";
import { createSessionUnlessBanned, type SignInSuccess } from "@/utils/auth";
import type { SessionRecheckState } from "@/utils/session-user";
import { hashToken } from "@/utils/random-token";
import { normalizeEmail } from "@/lib/validation";
import { userByEmailWhere } from "@/lib/auth/user-email";
import { RATE_LIMITS, withRateLimit } from "@/utils/with-rate-limit";

// Built by the real hasher on first use, so its format and PBKDF2 cost follow password-hasher.ts.
let dummyPasswordHash: Promise<string> | null = null;

interface SignInWithPasswordParams {
  email: string;
  password: string;
}

type Database = ReturnType<typeof getDB>;

interface PasswordSignInUser {
  id: string;
  passwordHash: string | null;
  bannedAt: Date | null;
}

function invalidCredentialsError(): ActionError {
  return new ActionError("NOT_AUTHORIZED", {
    key: "Client.Auth.SignIn.errorInvalidCredentials",
  });
}

async function getPasswordSignInUser({
  db,
  email,
}: {
  db: Database;
  email: string;
}): Promise<(PasswordSignInUser & { passwordHash: string }) | null> {
  const user = await db.query.userTable.findFirst({
    where: userByEmailWhere(email),
    columns: {
      id: true,
      passwordHash: true,
      bannedAt: true,
    },
  });

  // A missing row and a Google-only row must look like a wrong password, also in time.
  if (!user?.passwordHash) {
    return null;
  }

  return {
    ...user,
    passwordHash: user.passwordHash,
  };
}

function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHash ??= hashPassword({ password: crypto.randomUUID() }).catch((error: unknown) => {
    dummyPasswordHash = null;
    throw error;
  });

  return dummyPasswordHash;
}

async function rejectWithoutPassword({ password }: { password: string }): Promise<never> {
  // Spend one real verification so this path costs the same as a wrong password; ignore the result.
  await verifyPassword({
    storedHash: await getDummyPasswordHash(),
    passwordAttempt: password,
  });

  throw invalidCredentialsError();
}

async function verifySignInPassword({
  password,
  storedHash,
}: {
  password: string;
  storedHash: string;
}): Promise<{ needsRehash: boolean }> {
  const verification = await verifyPassword({
    storedHash,
    passwordAttempt: password,
  });

  if (!verification.isValid) {
    throw invalidCredentialsError();
  }

  return { needsRehash: verification.needsRehash };
}

async function requirePasswordSignIn({
  db,
  userId,
}: {
  db: Database;
  userId: string;
}): Promise<void> {
  const passkey = await db.query.passKeyCredentialTable.findFirst({
    where: { userId },
    columns: {
      id: true,
    },
  });

  if (passkey) {
    throw new ActionError("FORBIDDEN", {
      key: "Client.Auth.SignIn.errorUsePasskey",
    });
  }
}

// Returns the hash the row holds after the attempt. A lost compare-and-set keeps the verified
// hash, so the session recheck sees the change that beat it.
async function upgradePasswordHash({
  db,
  password,
  storedHash,
  userId,
}: {
  db: Database;
  password: string;
  storedHash: string;
  userId: string;
}): Promise<string> {
  try {
    const passwordHash = await hashPassword({ password });
    const updated = await db
      .update(userTable)
      .set({ passwordHash })
      .where(and(
        eq(userTable.id, userId),
        eq(userTable.passwordHash, storedHash),
      ))
      .returning({ id: userTable.id });

    return updated.length > 0 ? passwordHash : storedHash;
  } catch (error) {
    // A hashing-policy migration should not lock out a user with valid credentials.
    console.error("Failed to upgrade password hash after sign-in", error);

    return storedHash;
  }
}

// A password reset or a Google reclaim can change the hash after the password verified. The
// session write re-reads the row after it, and a changed hash rolls that one session back.
function assertPasswordHashUnchanged({
  state,
  verifiedHash,
}: {
  state: SessionRecheckState | null;
  verifiedHash: string;
}): void {
  if (state?.passwordHash !== verifiedHash) {
    throw invalidCredentialsError();
  }
}

async function authenticateWithPassword({
  email,
  password,
}: SignInWithPasswordParams): Promise<SignInSuccess> {
  const db = getDB();
  const user = await getPasswordSignInUser({ db, email });
  if (!user) {
    return rejectWithoutPassword({ password });
  }

  const { needsRehash } = await verifySignInPassword({
    password,
    storedHash: user.passwordHash,
  });

  // After the password verifies, never before: checking first would tell an anonymous caller
  // which addresses are banned. By here they have already proved they know the credential.
  assertNotBanned(user);

  await requirePasswordSignIn({ db, userId: user.id });

  const verifiedHash = needsRehash
    ? await upgradePasswordHash({
      db,
      password,
      storedHash: user.passwordHash,
      userId: user.id,
    })
    : user.passwordHash;

  // Re-checks the ban and the hash after it writes the session, so a ban, reset, or reclaim
  // landing since the checks above cannot leave a live session behind.
  const { preferredLocale } = await createSessionUnlessBanned({
    userId: user.id,
    authenticationType: "password",
    recheck: (state) => assertPasswordHashUnchanged({ state, verifiedHash }),
  });

  return { success: true, preferredLocale };
}

async function authenticateWithErrorMapping(
  params: SignInWithPasswordParams,
): Promise<SignInSuccess> {
  try {
    return await authenticateWithPassword(params);
  } catch (error) {
    // Expected auth failures (e.g. wrong password) are ActionErrors; only log the unexpected ones.
    if (error instanceof ActionError) {
      throw error;
    }

    console.error(error);

    throw new ActionError("INTERNAL_SERVER_ERROR", {
      key: "Client.Errors.unexpected",
    });
  }
}

export async function signInWithPassword({
  email,
  password,
}: SignInWithPasswordParams): Promise<SignInSuccess> {
  // Normalize once at the action boundary so the DB lookup, the account rate-limit key, and any
  // downstream logic all key off the same canonical identity. Previously the lookup used the raw
  // input while the rate-limit bucket used a separately lowercased copy — an identity split that
  // let differently cased spellings of one account sidestep the per-account throttle.
  const canonicalEmail = normalizeEmail(email);
  const accountIdentifier = `account:${await hashToken(canonicalEmail)}`;

  return withRateLimit(
    () => withRateLimit(
      () => authenticateWithErrorMapping({ email: canonicalEmail, password }),
      {
        ...RATE_LIMITS.SIGN_IN_ACCOUNT,
        userIdentifier: accountIdentifier,
        // Only failed attempts should consume the account bucket, so a legitimate user
        // can't lock themselves out and an attacker can't lock out a victim's account.
        resetOnSuccess: true,
      },
    ),
    RATE_LIMITS.SIGN_IN,
  );
}
