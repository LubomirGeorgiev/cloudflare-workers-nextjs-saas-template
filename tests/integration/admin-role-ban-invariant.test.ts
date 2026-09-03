/// <reference types="@cloudflare/vitest-plugin/types" />

// "A banned account is never an admin" is kept by two writers, not one: `banUser` refuses to ban
// an admin, and `setUserRole` refuses to promote a banned account. Only the pair holds — with the
// promotion guard missing, ban → promote → unban ends with a banned-then-cleared admin.
//
// Real Miniflare D1 and KV, so the ban that the promotion sees is the one `banUser` actually
// wrote. Only the OAuth grant module is mocked, because it reaches the provider, which has its
// own suite; the same reason `user-ban.test.ts` mocks it.

import { expect, test, vi } from "vitest";

vi.mock("@/lib/oauth/connected-apps", () => ({
  listConnectedAppsForUser: async () => [],
  revokeConnectedAppForUser: async () => undefined,
}));

import { ROLES_ENUM } from "@/app/enums";
import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { banUser, unbanUser } from "@/lib/admin/user-ban";
import { setUserRole } from "@/lib/admin/users";

const db = getDB();

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

async function seedBannedUser(): Promise<string> {
  const userId = uid("usr");

  await db.insert(userTable).values({
    id: userId,
    email: `${userId}@example.com`,
    emailVerified: new Date(),
    firstName: "Test",
    role: ROLES_ENUM.USER,
  });

  await banUser({ userId, internalReason: "Abuse wave", sendEmail: false, actorUserId: null });

  return userId;
}

async function readRole(userId: string): Promise<string | undefined> {
  const row = await db.query.userTable.findFirst({ where: { id: userId }, columns: { role: true } });

  return row?.role;
}

test("a banned account cannot be promoted to admin", async () => {
  const userId = await seedBannedUser();

  await expect(setUserRole({ userId, role: ROLES_ENUM.ADMIN })).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });

  expect(await readRole(userId)).toBe(ROLES_ENUM.USER);
});

// The whole point of the finding: the unban must not be able to reveal an admin.
test("ban, promote, unban leaves an ordinary user", async () => {
  const userId = await seedBannedUser();

  await expect(setUserRole({ userId, role: ROLES_ENUM.ADMIN })).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });

  await unbanUser({ userId, internalReason: "Appeal upheld", sendEmail: false, actorUserId: null });

  expect(await readRole(userId)).toBe(ROLES_ENUM.USER);
});

test("the same account can be promoted once it is unbanned", async () => {
  const userId = await seedBannedUser();

  await unbanUser({ userId, internalReason: "Appeal upheld", sendEmail: false, actorUserId: null });
  const promoted = await setUserRole({ userId, role: ROLES_ENUM.ADMIN });

  expect(promoted.role).toBe(ROLES_ENUM.ADMIN);
});

// Demotion only ever moves toward the invariant, so the guard must not reach it.
test("a banned account can still be demoted", async () => {
  const userId = await seedBannedUser();

  const demoted = await setUserRole({ userId, role: ROLES_ENUM.USER });

  expect(demoted.role).toBe(ROLES_ENUM.USER);
  expect(demoted.bannedAt).toBeInstanceOf(Date);
});

test("promoting a user id that does not exist is still NOT_FOUND", async () => {
  await expect(setUserRole({ userId: uid("missing"), role: ROLES_ENUM.ADMIN })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
