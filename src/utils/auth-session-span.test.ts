import { beforeEach, describe, expect, test, vi } from "vitest";

const CURRENT_SESSION_VERSION = 7;
const STALE_SESSION_VERSION = CURRENT_SESSION_VERSION - 1;
const SESSION_VALIDATE_SPAN_NAME = "app.auth.session.validate";
const SESSION_OUTCOME_ATTRIBUTE = "app.auth.session.outcome";

const {
  cookieStore,
  deleteKVSessionMock,
  enteredSpans,
  getKVSessionMock,
  spanAttributes,
  updateKVSessionMock,
} = vi.hoisted(() => ({
  cookieStore: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  deleteKVSessionMock: vi.fn(),
  enteredSpans: [] as string[],
  getKVSessionMock: vi.fn(),
  spanAttributes: new Map<string, unknown>(),
  updateKVSessionMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("react", () => ({
  cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

vi.mock("@/utils/trace", () => ({
  recordSpanException: vi.fn(),
  withSpan: ({ name, run }: { name: string; run: (span: unknown) => Promise<unknown> }) => {
    enteredSpans.push(name);

    return run({
      isTraced: true,
      setAttribute: (key: string, value: unknown) => {
        spanAttributes.set(key, value);
      },
    });
  },
}));

vi.mock("@/utils/session-user", () => ({
  getUserBannedAt: vi.fn(),
  getUserFromDB: vi.fn(),
  getUserTeamsWithPermissions: vi.fn(async () => []),
}));

vi.mock("./kv-session", () => ({
  CURRENT_SESSION_VERSION,
  createKVSession: vi.fn(),
  deleteKVSession: deleteKVSessionMock,
  getKVSession: getKVSessionMock,
  updateKVSession: updateKVSessionMock,
}));

vi.mock("@/utils/user-activity", () => ({
  touchUserLastActiveAt: vi.fn(),
}));

const { getCurrentSession } = await import("./auth");

describe("session validate span", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enteredSpans.length = 0;
    spanAttributes.clear();
    cookieStore.get.mockReturnValue({ value: "user-1:token-1" });
  });

  test("tags a current session as valid", async () => {
    getKVSessionMock.mockResolvedValue(buildStoredSession());

    await expect(getCurrentSession()).resolves.toMatchObject({ userId: "user-1" });

    expectOutcome("valid");
  });

  test("tags a session that KV does not have as missing", async () => {
    getKVSessionMock.mockResolvedValue(null);

    await expect(getCurrentSession()).resolves.toBeNull();

    expectOutcome("missing");
  });

  test("tags an expired session and still deletes it", async () => {
    getKVSessionMock.mockResolvedValue(buildStoredSession({ expiresAt: Date.now() - 1 }));

    await expect(getCurrentSession()).resolves.toBeNull();

    expect(deleteKVSessionMock).toHaveBeenCalledOnce();
    expectOutcome("expired");
  });

  test("tags a stored snapshot that carries a ban", async () => {
    getKVSessionMock.mockResolvedValue(buildStoredSession({ bannedAt: "2026-01-01T00:00:00.000Z" }));

    await expect(getCurrentSession()).resolves.toBeNull();

    expectOutcome("banned");
  });

  test("tags a stale-version session that the refresh rebuilds", async () => {
    getKVSessionMock.mockResolvedValue(buildStoredSession({ version: STALE_SESSION_VERSION }));
    updateKVSessionMock.mockResolvedValue(buildStoredSession());

    await expect(getCurrentSession()).resolves.toMatchObject({ userId: "user-1" });

    expectOutcome("version_refreshed");
  });

  test("tags a refresh that finds no session", async () => {
    getKVSessionMock.mockResolvedValue(buildStoredSession({ version: STALE_SESSION_VERSION }));
    updateKVSessionMock.mockResolvedValue(null);

    await expect(getCurrentSession()).resolves.toBeNull();

    expectOutcome("refresh_failed");
  });

  test("tags a ban that only the refreshed snapshot carries", async () => {
    getKVSessionMock.mockResolvedValue(buildStoredSession({ version: STALE_SESSION_VERSION }));
    updateKVSessionMock.mockResolvedValue(buildStoredSession({ bannedAt: "2026-01-01T00:00:00.000Z" }));

    await expect(getCurrentSession()).resolves.toBeNull();

    expectOutcome("refreshed_banned");
  });

  test("opens no span when the request has no session cookie", async () => {
    cookieStore.get.mockReturnValue(undefined);

    await expect(getCurrentSession()).resolves.toBeNull();

    expect(enteredSpans).toEqual([]);
    expect(getKVSessionMock).not.toHaveBeenCalled();
  });

  test("puts no user or session identifier on the span", async () => {
    getKVSessionMock.mockResolvedValue(buildStoredSession());

    await getCurrentSession();

    expect([...spanAttributes.keys()]).toEqual([SESSION_OUTCOME_ATTRIBUTE]);
  });
});

function expectOutcome(outcome: string): void {
  expect(enteredSpans).toEqual([SESSION_VALIDATE_SPAN_NAME]);
  expect(spanAttributes.get(SESSION_OUTCOME_ATTRIBUTE)).toBe(outcome);
}

function buildStoredSession({
  bannedAt = null,
  expiresAt = Date.now() + 60_000,
  version = CURRENT_SESSION_VERSION,
}: {
  bannedAt?: string | null;
  expiresAt?: number;
  version?: number;
} = {}) {
  return {
    id: "kv-session-1",
    userId: "user-1",
    createdAt: Date.now(),
    expiresAt,
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
