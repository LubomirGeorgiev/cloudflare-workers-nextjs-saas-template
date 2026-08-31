// The role row is already durable when the demotion cleanup runs, so a cleanup failure must never
// skip the session refresh: the cookie session still carries the old role and `requireAdmin` trusts
// it. The listing filters are here too, because the count and the page must never disagree.

import { beforeEach, expect, test, vi } from "vitest";

const {
  dbMock,
  likeCalls,
  revokeInternalApiKeysForUserMock,
  revokeInternalOAuthGrantsForUserMock,
  updateAllSessionsOfUserMock,
} = vi.hoisted(() => ({
  dbMock: {
    select: vi.fn(),
    update: vi.fn(),
    query: { userTable: { findMany: vi.fn(), findFirst: vi.fn() } },
  },
  likeCalls: [] as string[],
  revokeInternalApiKeysForUserMock: vi.fn(),
  revokeInternalOAuthGrantsForUserMock: vi.fn(),
  updateAllSessionsOfUserMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/db", () => ({ getDB: () => dbMock }));

// The count filter is built with a drizzle operator now, so the pattern it receives is only visible
// through the operator itself; the relational filter is read straight off the findMany argument.
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  like: (_column: unknown, pattern: string) => {
    likeCalls.push(pattern);
    return { pattern };
  },
}));

vi.mock("@/lib/admin/admin-api-keys", () => ({
  revokeInternalApiKeysForUser: revokeInternalApiKeysForUserMock,
}));

vi.mock("@/lib/admin/admin-oauth-grants", () => ({
  revokeInternalOAuthGrantsForUser: revokeInternalOAuthGrantsForUserMock,
}));

vi.mock("@/utils/kv-session", () => ({
  updateAllSessionsOfUser: updateAllSessionsOfUserMock,
}));

const { ROLES_ENUM } = await import("@/app/enums");
const { listAdminUsers, setUserRole } = await import("@/lib/admin/users");

const USER_ID = "usr_1";

function summaryRow(role: string) {
  return {
    id: USER_ID,
    email: "user@example.com",
    firstName: null,
    lastName: null,
    role,
    emailVerified: new Date(),
    createdAt: new Date(),
    lastActiveAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  likeCalls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  dbMock.select.mockImplementation(() => ({
    from: () => ({ where: async () => [{ count: 0 }] }),
  }));
  dbMock.update.mockImplementation(() => ({
    set: () => ({ where: () => ({ returning: async () => [{ id: USER_ID }] }) }),
  }));
  dbMock.query.userTable.findMany.mockResolvedValue([]);
  dbMock.query.userTable.findFirst.mockResolvedValue(summaryRow(ROLES_ENUM.USER));
  revokeInternalApiKeysForUserMock.mockResolvedValue(0);
  revokeInternalOAuthGrantsForUserMock.mockResolvedValue(0);
  updateAllSessionsOfUserMock.mockResolvedValue(undefined);
});

test("demotion revokes both credential kinds and then refreshes sessions", async () => {
  await setUserRole({ userId: USER_ID, role: ROLES_ENUM.USER });

  expect(revokeInternalApiKeysForUserMock).toHaveBeenCalledWith(USER_ID);
  expect(revokeInternalOAuthGrantsForUserMock).toHaveBeenCalledWith(USER_ID);
  expect(updateAllSessionsOfUserMock).toHaveBeenCalledWith(USER_ID);
});

test("a failed key revocation still refreshes sessions and still revokes the grants", async () => {
  revokeInternalApiKeysForUserMock.mockRejectedValue(new Error("D1 unavailable"));

  await expect(setUserRole({ userId: USER_ID, role: ROLES_ENUM.USER })).resolves.toMatchObject({
    id: USER_ID,
  });

  expect(revokeInternalOAuthGrantsForUserMock).toHaveBeenCalledWith(USER_ID);
  expect(updateAllSessionsOfUserMock).toHaveBeenCalledWith(USER_ID);
});

test("a failed grant revocation still refreshes sessions and still revokes the keys", async () => {
  revokeInternalOAuthGrantsForUserMock.mockRejectedValue(new Error("KV unavailable"));

  await setUserRole({ userId: USER_ID, role: ROLES_ENUM.USER });

  expect(revokeInternalApiKeysForUserMock).toHaveBeenCalledWith(USER_ID);
  expect(updateAllSessionsOfUserMock).toHaveBeenCalledWith(USER_ID);
});

test("promotion revokes nothing but still refreshes sessions", async () => {
  dbMock.query.userTable.findFirst.mockResolvedValue(summaryRow(ROLES_ENUM.ADMIN));

  await setUserRole({ userId: USER_ID, role: ROLES_ENUM.ADMIN });

  expect(revokeInternalApiKeysForUserMock).not.toHaveBeenCalled();
  expect(revokeInternalOAuthGrantsForUserMock).not.toHaveBeenCalled();
  expect(updateAllSessionsOfUserMock).toHaveBeenCalledWith(USER_ID);
});

test("the count and the page filter on one email pattern", async () => {
  await listAdminUsers({ page: 1, pageSize: 10, emailFilter: "needle" });

  const listWhere = dbMock.query.userTable.findMany.mock.calls[0]?.[0]?.where;

  expect(likeCalls).toEqual(["%needle%"]);
  expect(listWhere).toEqual({ email: { like: likeCalls[0] } });
});

test("an absent email filter narrows neither the count nor the page", async () => {
  await listAdminUsers({ page: 1, pageSize: 10 });

  expect(likeCalls).toEqual([]);
  expect(dbMock.query.userTable.findMany.mock.calls[0]?.[0]?.where).toBeUndefined();
});
