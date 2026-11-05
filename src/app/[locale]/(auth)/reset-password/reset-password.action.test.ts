import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const {
  calls,
  deleteAllSessionsOfUserMock,
  findUserMock,
  getValidPasswordResetTokenMock,
  revokePasswordResetTokensOfUserMock,
  updateSetMock,
} = vi.hoisted(() => {
  const order: string[] = [];

  return {
    calls: order,
    deleteAllSessionsOfUserMock: vi.fn(async () => {
      order.push("sessions");
    }),
    findUserMock: vi.fn(),
    getValidPasswordResetTokenMock: vi.fn(),
    revokePasswordResetTokensOfUserMock: vi.fn(async () => {
      order.push("reset-links");
    }),
    updateSetMock: vi.fn(() => ({
      where: async () => {
        order.push("password-hash");
      },
    })),
  };
});

vi.mock("server-only", () => ({}));

const actionClientMock = {
  action: (handler: (args: { parsedInput: unknown }) => unknown) => {
    return (input?: unknown) => handler({ parsedInput: input });
  },
  inputSchema() {
    return actionClientMock;
  },
  metadata() {
    return actionClientMock;
  },
};

vi.mock("@/lib/safe-action", () => ({ actionClient: actionClientMock }));

vi.mock("@/db", () => ({
  getDB: () => ({
    update: () => ({ set: updateSetMock }),
    query: { userTable: { findFirst: findUserMock } },
  }),
}));

vi.mock("@/db/schema", () => ({ userTable: { id: "id" } }));
vi.mock("@/utils/password-hasher", () => ({ hashPassword: vi.fn(async () => "new-hash") }));
vi.mock("@/lib/account/ban", () => ({ assertNotBanned: vi.fn() }));
vi.mock("@/utils/kv-session", () => ({ deleteAllSessionsOfUser: deleteAllSessionsOfUserMock }));
vi.mock("@/utils/password-reset-token", () => ({
  getValidPasswordResetToken: getValidPasswordResetTokenMock,
  revokePasswordResetTokensOfUser: revokePasswordResetTokensOfUserMock,
}));

// The real module reads Worker bindings at import time; only the pass-through matters here.
vi.mock("@/utils/with-rate-limit", () => ({
  RATE_LIMITS: { RESET_PASSWORD: { identifier: "auth", limit: 1, windowInSeconds: 1 } },
  withRateLimit: vi.fn(async (action: () => Promise<unknown>) => action()),
}));

const { resetPasswordAction } = await import("./reset-password.action");

const USER_ID = "usr_1";
const INPUT = { token: "used-token", password: "N3w-password!", confirmPassword: "N3w-password!" };

describe("resetPasswordAction", () => {
  beforeEach(() => {
    getValidPasswordResetTokenMock.mockResolvedValue({ userId: USER_ID });
    findUserMock.mockResolvedValue({ id: USER_ID });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
  });

  // A sign-in that writes its session after the revoke must already see the new hash on its
  // recheck, so the write comes first. The link revoke goes last, so a retry can repeat the revoke.
  test("writes the new hash, then revokes sessions, and revokes the reset links last", async () => {
    await expect(resetPasswordAction(INPUT)).resolves.toEqual({ success: true });

    expect(updateSetMock).toHaveBeenCalledWith({ passwordHash: "new-hash" });
    expect(deleteAllSessionsOfUserMock).toHaveBeenCalledWith(USER_ID);
    expect(revokePasswordResetTokensOfUserMock).toHaveBeenCalledWith(USER_ID);
    expect(calls).toEqual(["password-hash", "sessions", "reset-links"]);
  });

  test("keeps the used link valid when the session revoke fails", async () => {
    deleteAllSessionsOfUserMock.mockRejectedValueOnce(new Error("KV unavailable"));

    await expect(resetPasswordAction(INPUT)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });

    expect(updateSetMock).toHaveBeenCalledWith({ passwordHash: "new-hash" });
    expect(revokePasswordResetTokensOfUserMock).not.toHaveBeenCalled();
  });

  test("does not revoke anything when the hash write fails", async () => {
    updateSetMock.mockImplementationOnce(() => ({
      where: async () => {
        throw new Error("D1 unavailable");
      },
    }));

    await expect(resetPasswordAction(INPUT)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });

    expect(deleteAllSessionsOfUserMock).not.toHaveBeenCalled();
    expect(revokePasswordResetTokensOfUserMock).not.toHaveBeenCalled();
  });
});
