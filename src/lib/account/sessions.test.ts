import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  getCurrentSessionMock,
  getAllSessionIdsOfUserMock,
  getKVSessionMock,
  deleteKVSessionMock,
} = vi.hoisted(() => ({
  getCurrentSessionMock: vi.fn(),
  getAllSessionIdsOfUserMock: vi.fn(),
  getKVSessionMock: vi.fn(),
  deleteKVSessionMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/utils/auth", () => ({ getCurrentSession: getCurrentSessionMock }));
vi.mock("@/utils/kv-session", () => ({
  getAllSessionIdsOfUser: getAllSessionIdsOfUserMock,
  getKVSession: getKVSessionMock,
  deleteKVSession: deleteKVSessionMock,
}));

const { getUserSessions } = await import("./sessions");

const USER_ID = "usr_test";
const CURRENT_SESSION_ID = "sess_current";
const OLDER_SESSION_ID = "sess_older";
const GONE_SESSION_ID = "sess_gone";

function kvSession({ id, createdAt }: { id: string; createdAt: number }) {
  return {
    id,
    userId: USER_ID,
    createdAt,
    expiresAt: createdAt + 60_000,
    user: { id: USER_ID, email: "ada@example.com" },
    userAgent: null,
  };
}

describe("getUserSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentSessionMock.mockResolvedValue({
      id: CURRENT_SESSION_ID,
      user: { id: USER_ID },
    });
    getAllSessionIdsOfUserMock.mockResolvedValue(
      [OLDER_SESSION_ID, GONE_SESSION_ID, CURRENT_SESSION_ID].map((sessionId) => ({
        key: `session:${USER_ID}:${sessionId}`,
        absoluteExpiration: undefined,
      })),
    );
    // The KV list can name a session whose entry has since expired; it must not reach the caller.
    getKVSessionMock.mockImplementation(async (sessionId: string) => {
      if (sessionId === GONE_SESSION_ID) {
        return null;
      }
      return kvSession({
        id: sessionId,
        createdAt: sessionId === CURRENT_SESSION_ID ? 2_000 : 1_000,
      });
    });
  });

  test("drops sessions KV no longer has and returns the newest first", async () => {
    const sessions = await getUserSessions();

    expect(sessions.map((session) => session.id)).toEqual([CURRENT_SESSION_ID, OLDER_SESSION_ID]);
  });

  test("marks the caller's own session and parses each user agent", async () => {
    const sessions = await getUserSessions();

    expect(sessions[0].isCurrentSession).toBe(true);
    expect(sessions[1].isCurrentSession).toBe(false);
    expect(sessions[0].parsedUserAgent).toBeDefined();
  });

  test("refuses a caller without a session", async () => {
    getCurrentSessionMock.mockResolvedValue(null);

    await expect(getUserSessions()).rejects.toThrowError(
      expect.objectContaining({ code: "NOT_AUTHORIZED" }),
    );
  });
});
