import { beforeEach, describe, expect, test, vi } from "vitest";

import { v } from "@/lib/validation";

import { ENABLED_LOCALES } from "./config";

vi.mock("server-only", () => ({}));

const {
  settingsRateLimit,
  getCurrentSessionMock,
  withUserRateLimitMock,
  whereMock,
  setMock,
  updateMock,
  getDBMock,
} = vi.hoisted(() => {
  const whereMock = vi.fn(async () => undefined);
  const setMock = vi.fn(() => ({ where: whereMock }));
  const updateMock = vi.fn(() => ({ set: setMock }));

  return {
    settingsRateLimit: { identifier: "settings", limit: 1, windowInSeconds: 1 },
    getCurrentSessionMock: vi.fn(),
    withUserRateLimitMock: vi.fn(async (action: () => Promise<unknown>) => action()),
    whereMock,
    setMock,
    updateMock,
    getDBMock: vi.fn(() => ({ update: updateMock })),
  };
});

vi.mock("@/utils/auth", () => ({
  getCurrentSession: getCurrentSessionMock,
}));

// The real module reads Worker bindings at import time; only the config identity matters here.
vi.mock("@/utils/with-rate-limit", () => ({
  RATE_LIMITS: { SETTINGS: settingsRateLimit },
}));

vi.mock("@/utils/with-user-rate-limit", () => ({
  withUserRateLimit: withUserRateLimitMock,
}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

// Runs the real input schema, so the test covers the trust boundary and not a stub of it.
vi.mock("@/lib/safe-action", () => ({
  actionClient: {
    inputSchema(schema: v.GenericSchema) {
      return {
        action(handler: (args: { parsedInput: unknown }) => Promise<unknown>) {
          return async (input: unknown) => {
            const parsed = v.safeParse(schema, input);

            if (!parsed.success) {
              return { validationErrors: parsed.issues };
            }

            return { data: await handler({ parsedInput: parsed.output }) };
          };
        },
      };
    },
  },
}));

const { setUserLocaleAction } = await import("./locale-actions");

// A served locale, derived from the enabled list, so this stays correct whether i18n is on or off
// and if downstream projects change the locale set.
const supportedLocale = ENABLED_LOCALES[ENABLED_LOCALES.length - 1];
const unsupportedLocale = "zz";

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentSessionMock.mockResolvedValue(null);
});

describe("setUserLocaleAction", () => {
  // `getUserLocale` reads the cookie first, so a stale session snapshot cannot outrank the new
  // choice; the row is what the next sign-in reads. No session refresh is needed.
  test("persists preferredLocale for a signed-in user without a session refresh", async () => {
    getCurrentSessionMock.mockResolvedValue({ user: { id: "user-1" } });

    const result = await setUserLocaleAction({ locale: supportedLocale });

    expect(result).toEqual({ data: { success: true } });
    expect(updateMock).toHaveBeenCalledOnce();
    expect(setMock).toHaveBeenCalledWith({ preferredLocale: supportedLocale });
    expect(whereMock).toHaveBeenCalledOnce();
    expect(withUserRateLimitMock).toHaveBeenCalledWith(expect.any(Function), settingsRateLimit);
  });

  test("succeeds without a DB write for an anonymous visitor", async () => {
    const result = await setUserLocaleAction({ locale: supportedLocale });

    expect(result).toEqual({ data: { success: true } });
    expect(getDBMock).not.toHaveBeenCalled();
    expect(withUserRateLimitMock).toHaveBeenCalledOnce();
  });

  test("rejects an unsupported locale before reading the session or DB", async () => {
    getCurrentSessionMock.mockResolvedValue({ user: { id: "user-1" } });

    // @ts-expect-error an unsupported locale exercises the schema guard
    const result = await setUserLocaleAction({ locale: unsupportedLocale });

    expect(result).toHaveProperty("validationErrors");
    expect(getCurrentSessionMock).not.toHaveBeenCalled();
    expect(getDBMock).not.toHaveBeenCalled();
  });
});
