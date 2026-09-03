import "server-only";

import { and, eq } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import { assertNotBanned } from "@/lib/account/ban";
import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/utils/password-hasher";
import { createSessionUnlessBanned } from "@/utils/auth";
import { hashToken } from "@/utils/random-token";
import { normalizeEmail } from "@/lib/validation";
import { RATE_LIMITS, withRateLimit } from "@/utils/with-rate-limit";

interface SignInWithPasswordParams {
  email: string;
  password: string;
}

type Database = ReturnType<typeof getDB>;

interface PasswordSignInUser {
  googleAccountId: string | null;
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
}): Promise<PasswordSignInUser & { passwordHash: string }> {
  // `email` is already canonicalized (trimmed + lowercased) at the action boundary. Sign-up
  // historically persisted the raw input, so legacy rows may hold mixed-case addresses; a plain
  // equality match on the lowercased value would miss them. Compare case-insensitively via
  // lower(email) so both legacy mixed-case rows and normalized rows resolve to one account.
  // Tradeoff: lower() forgoes a plain index on email, but this runs once per sign-in attempt.
  const user = await db.query.userTable.findFirst({
    where: {
      RAW: (table, { sql }) => sql`lower(${table.email}) = ${email}`,
    },
    columns: {
      googleAccountId: true,
      id: true,
      passwordHash: true,
      bannedAt: true,
    },
  });

  if (!user) {
    throw invalidCredentialsError();
  }

  if (!user.passwordHash && user.googleAccountId) {
    throw new ActionError("FORBIDDEN", {
      key: "Client.Auth.SignIn.errorUseGoogle",
    });
  }

  if (!user.passwordHash) {
    throw invalidCredentialsError();
  }

  return {
    ...user,
    passwordHash: user.passwordHash,
  };
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
}): Promise<void> {
  try {
    const passwordHash = await hashPassword({ password });
    await db
      .update(userTable)
      .set({ passwordHash })
      .where(and(
        eq(userTable.id, userId),
        eq(userTable.passwordHash, storedHash),
      ));
  } catch (error) {
    // A hashing-policy migration should not lock out a user with valid credentials.
    console.error("Failed to upgrade password hash after sign-in", error);
  }
}

async function authenticateWithPassword({
  email,
  password,
}: SignInWithPasswordParams): Promise<{ success: true }> {
  const db = getDB();
  const user = await getPasswordSignInUser({ db, email });
  const { needsRehash } = await verifySignInPassword({
    password,
    storedHash: user.passwordHash,
  });

  // After the password verifies, never before: checking first would tell an anonymous caller
  // which addresses are banned. By here they have already proved they know the credential.
  assertNotBanned(user);

  await requirePasswordSignIn({ db, userId: user.id });

  if (needsRehash) {
    await upgradePasswordHash({
      db,
      password,
      storedHash: user.passwordHash,
      userId: user.id,
    });
  }

  // Re-checks the ban after it writes the session, so a ban landing since the check above cannot
  // leave a live session behind.
  await createSessionUnlessBanned({ userId: user.id, authenticationType: "password" });

  return { success: true };
}

async function authenticateWithErrorMapping(
  params: SignInWithPasswordParams,
): Promise<{ success: true }> {
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
}: SignInWithPasswordParams): Promise<{ success: true }> {
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
