import { beforeEach, describe, expect, test, vi } from "vitest";

import { SESSION_COOKIE_NAME } from "@/constants";

const CURRENT_SESSION_VERSION = 7;
const STALE_SESSION_VERSION = CURRENT_SESSION_VERSION - 1;

const cookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

const createKVSessionMock = vi.fn();
const deleteKVSessionMock = vi.fn();
const getKVSessionMock = vi.fn();
const updateKVSessionMock = vi.fn();
const getUserBannedAtMock = vi.fn();
const getUserFromDBMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("react", () => ({
  cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

vi.mock("@/utils/session-user", () => ({
  getUserBannedAt: getUserBannedAtMock,
  getUserFromDB: getUserFromDBMock,
  getUserTeamsWithPermissions: vi.fn(async () => []),
}));

vi.mock("./kv-session", () => ({
  CURRENT_SESSION_VERSION,
  createKVSession: createKVSessionMock,
  deleteKVSession: deleteKVSessionMock,
  getKVSession: getKVSessionMock,
  updateKVSession: updateKVSessionMock,
}));

vi.mock("@/utils/user-activity", () => ({
  touchUserLastActiveAt: vi.fn(),
}));

const { createSessionUnlessBanned, getCurrentSession } = await import("./auth");

function buildStoredSession({ bannedAt = null, version = CURRENT_SESSION_VERSION }: {
  bannedAt?: Date | string | null;
  version?: number;
} = {}) {
  return {
    id: "kv-session-1",
    userId: "user-1",
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    version,
    user: {
      id: "user-1",
      email: "user@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      bannedAt,
    },
  };
}

describe("createSessionUnlessBanned", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserFromDBMock.mockResolvedValue({ id: "user-1", bannedAt: null });
    createKVSessionMock.mockImplementation(async () => buildStoredSession());
    getUserBannedAtMock.mockResolvedValue(null);
  });

  test("stores the session and sets the cookie when the account is not banned", async () => {
    await createSessionUnlessBanned({ userId: "user-1", authenticationType: "password" });

    expect(createKVSessionMock).toHaveBeenCalledOnce();
    expect(deleteKVSessionMock).not.toHaveBeenCalled();
    expect(cookieStore.set).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      expect.stringMatching(/^user-1:/),
      expect.objectContaining({ httpOnly: true }),
    );
  });

  // The race this helper exists for: the chokepoint's own check read D1 before the ban landed, so
  // only the read after the write can see it.
  test("deletes the session and refuses when the ban lands between the two reads", async () => {
    getUserBannedAtMock.mockResolvedValue(new Date("2026-01-01T00:00:00.000Z"));

    await expect(createSessionUnlessBanned({
      userId: "user-1",
      authenticationType: "password",
    })).rejects.toMatchObject({
      code: "FORBIDDEN",
      messageKey: "Client.Auth.SignIn.errorAccountSuspended",
    });

    expect(deleteKVSessionMock).toHaveBeenCalledWith("kv-session-1", "user-1");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});

describe("cookie session ban checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieStore.get.mockReturnValue({ value: "user-1:token-1" });
  });

  test("deletes a stored snapshot that carries a ban", async () => {
    getKVSessionMock.mockResolvedValue(buildStoredSession({ bannedAt: "2026-01-01T00:00:00.000Z" }));

    await expect(getCurrentSession()).resolves.toBeNull();

    expect(deleteKVSessionMock).toHaveBeenCalledWith(expect.any(String), "user-1");
    expect(updateKVSessionMock).not.toHaveBeenCalled();
  });

  // A stale-version session is rebuilt from D1, so the ban only appears on the refreshed object.
  test("deletes a stale-version session whose refreshed snapshot carries a ban", async () => {
    getKVSessionMock.mockResolvedValue(buildStoredSession({ version: STALE_SESSION_VERSION }));
    updateKVSessionMock.mockResolvedValue(buildStoredSession({
      bannedAt: new Date("2026-01-01T00:00:00.000Z"),
    }));

    await expect(getCurrentSession()).resolves.toBeNull();

    expect(updateKVSessionMock).toHaveBeenCalledOnce();
    expect(deleteKVSessionMock).toHaveBeenCalledWith(expect.any(String), "user-1");
  });

  test("returns a refreshed session when the account is not banned", async () => {
    getKVSessionMock.mockResolvedValue(buildStoredSession({ version: STALE_SESSION_VERSION }));
    updateKVSessionMock.mockResolvedValue(buildStoredSession());

    const session = await getCurrentSession();

    expect(session?.userId).toBe("user-1");
    expect(deleteKVSessionMock).not.toHaveBeenCalled();
  });
});
