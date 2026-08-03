import { beforeEach, describe, expect, test, vi } from "vitest";

import { SESSION_COOKIE_NAME } from "@/constants";
import type { ApiKeyPrincipal } from "@/lib/api/principal";

const CURRENT_SESSION_VERSION = 6;

const cookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

const cookiesMock = vi.fn(async () => cookieStore);
const getKVSessionMock = vi.fn();
const cacheMemos: Map<string, unknown>[] = [];

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

// Mimics React's per-request memoization so the tests can prove the ALS lookup sits outside it:
// a memoized cookie session must never be handed to a bearer principal.
vi.mock("react", () => ({
  cache: (fn: (...args: unknown[]) => unknown) => {
    const results = new Map<string, unknown>();
    cacheMemos.push(results);

    return (...args: unknown[]) => {
      const key = JSON.stringify(args);
      if (!results.has(key)) {
        results.set(key, fn(...args));
      }
      return results.get(key);
    };
  },
}));

vi.mock("@/utils/session-user", () => ({
  getUserFromDB: vi.fn(),
  getUserTeamsWithPermissions: vi.fn(),
}));

vi.mock("@/utils/kv-session", () => ({
  CURRENT_SESSION_VERSION,
  createKVSession: vi.fn(),
  deleteKVSession: vi.fn(),
  getKVSession: getKVSessionMock,
  updateKVSession: vi.fn(),
}));

const touchUserLastActiveAtMock = vi.fn();

vi.mock("@/utils/user-activity", () => ({
  touchUserLastActiveAt: touchUserLastActiveAtMock,
}));

const { runWithPrincipal } = await import("@/lib/api/principal");
const { getCurrentSession } = await import("@/utils/auth");

function buildPrincipal(overrides: Partial<ApiKeyPrincipal> = {}): ApiKeyPrincipal {
  return {
    kind: "api-key",
    userId: "user-key",
    user: {
      id: "user-key",
      email: "agent@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
    } as ApiKeyPrincipal["user"],
    teams: [],
    scopes: ["profile:read"],
    audience: { type: "personal" },
    keyId: "akey_1",
    ...overrides,
  };
}

function buildCookieSession(userId: string) {
  return {
    id: "kv-session-1",
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    version: CURRENT_SESSION_VERSION,
    user: { id: userId, email: "cookie@example.com", firstName: "Cookie", lastName: "User" },
  };
}

describe("getCurrentSession principal bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const memo of cacheMemos) {
      memo.clear();
    }
    cookieStore.get.mockReturnValue({ value: "user-cookie:token-1" });
    getKVSessionMock.mockImplementation(async () => buildCookieSession("user-cookie"));
  });

  test("returns the ALS principal without reading cookies", async () => {
    const principal = buildPrincipal();

    const session = await runWithPrincipal(principal, () => getCurrentSession());

    expect(session?.userId).toBe("user-key");
    // Bearer sessions store nothing in KV, so the storage fields are null, not invented — and the
    // kind says so outright rather than leaving callers to infer it from a null id.
    expect(session?.kind).toBe("bearer");
    expect(session?.id).toBeNull();
    expect(session?.expiresAt).toBeNull();
    expect(session?.user.initials).toBe("AL");
    expect(cookiesMock).not.toHaveBeenCalled();
    expect(getKVSessionMock).not.toHaveBeenCalled();
  });

  test("never serves a memoized session across different principals", async () => {
    const first = await runWithPrincipal(
      buildPrincipal({ userId: "user-a", keyId: "akey_a" }),
      () => getCurrentSession(),
    );
    const second = await runWithPrincipal(
      buildPrincipal({ userId: "user-b", keyId: "akey_b" }),
      () => getCurrentSession(),
    );

    expect(first?.userId).toBe("user-a");
    expect(second?.userId).toBe("user-b");
  });

  test("falls back to the cookie session when no principal is in scope", async () => {
    const session = await getCurrentSession();

    expect(session?.userId).toBe("user-cookie");
    expect(cookiesMock).toHaveBeenCalled();
  });

  // `lastActiveAt` is a record of people using the app, so machine traffic must not schedule a D1
  // write on every authenticated API/MCP call just for asking who it is.
  test("stamps user activity for cookie callers and never for bearer credentials", async () => {
    await runWithPrincipal(buildPrincipal(), () => getCurrentSession());
    expect(touchUserLastActiveAtMock).not.toHaveBeenCalled();

    await getCurrentSession();
    expect(touchUserLastActiveAtMock).toHaveBeenCalledExactlyOnceWith("user-cookie");
  });

  test("keeps the cookie path memoized within a request", async () => {
    await getCurrentSession();
    await getCurrentSession();

    expect(getKVSessionMock).toHaveBeenCalledTimes(1);
  });

  test("does not leak a cookie session into a bearer request", async () => {
    await getCurrentSession();

    const session = await runWithPrincipal(buildPrincipal(), () => getCurrentSession());

    expect(session?.userId).toBe("user-key");
    expect(cookieStore.get).toHaveBeenCalledWith(SESSION_COOKIE_NAME);
  });
});
