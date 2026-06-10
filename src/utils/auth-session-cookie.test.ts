import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  AUTH_SESSION_PRESENT_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "@/constants";

const cookieStore = {
  delete: vi.fn(),
  set: vi.fn(),
};

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

vi.mock("@/utils/credits", () => ({
  refreshUserCreditsAfterAuthentication: vi.fn(),
}));

vi.mock("@/utils/session-user", () => ({
  getUserFromDB: vi.fn(),
  getUserTeamsWithPermissions: vi.fn(),
}));

vi.mock("./kv-session", () => ({
  CURRENT_SESSION_VERSION: 4,
  createKVSession: vi.fn(),
  deleteKVSession: vi.fn(),
  getKVSession: vi.fn(),
  updateKVSession: vi.fn(),
}));

const {
  deleteSessionTokenCookie,
  setSessionTokenCookie,
} = await import("./auth");

describe("auth session cookies", () => {
  beforeEach(() => {
    cookieStore.delete.mockClear();
    cookieStore.set.mockClear();
  });

  test("sets a server-owned readable session-present cookie with the session token cookie", async () => {
    const expiresAt = new Date("2026-06-10T12:00:00.000Z");

    await setSessionTokenCookie({
      token: "token-1",
      userId: "user-1",
      expiresAt,
    });

    expect(cookieStore.set).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      "user-1:token-1",
      {
        expires: expiresAt,
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: false,
      },
    );
    expect(cookieStore.set).toHaveBeenCalledWith(
      AUTH_SESSION_PRESENT_COOKIE_NAME,
      "1",
      {
        expires: expiresAt,
        httpOnly: false,
        path: "/",
        sameSite: "lax",
        secure: false,
      },
    );
  });

  test("deletes the readable session-present cookie with the session token cookie", async () => {
    await deleteSessionTokenCookie();

    expect(cookieStore.delete).toHaveBeenCalledWith(SESSION_COOKIE_NAME);
    expect(cookieStore.delete).toHaveBeenCalledWith(AUTH_SESSION_PRESENT_COOKIE_NAME);
  });
});
