import { afterEach, describe, expect, test, vi } from "vitest";

import type { SessionValidationResult } from "@/types";
import { useSessionStore } from "@/state/session";

import { SessionHydrator, getSessionHydrationKey } from "./session-hydrator";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  return {
    ...actual,
    useEffect: vi.fn(),
    useRef: vi.fn(() => ({ current: null })),
  };
});

interface CreateSessionOptions {
  role?: string;
  emailVerified?: Date | null;
  updatedAt?: Date;
  currentCredits?: number;
}

const initialState = useSessionStore.getInitialState();

describe("SessionHydrator", () => {
  afterEach(() => {
    useSessionStore.setState(initialState, true);
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  test("does not hydrate the external session store during render", () => {
    const hydrateSessionFromServer = vi.fn();
    useSessionStore.setState({ hydrateSessionFromServer });

    SessionHydrator({
      children: "Dashboard",
      session: createSession(),
    });

    expect(hydrateSessionFromServer).not.toHaveBeenCalled();
  });

  test("does not build the hydration key during render", () => {
    const stringify = vi.spyOn(JSON, "stringify");

    SessionHydrator({
      children: "Dashboard",
      session: createSession(),
    });

    expect(stringify).not.toHaveBeenCalled();
  });

  test("uses the same hydration key for semantically identical session payloads", () => {
    expect(getSessionHydrationKey(createSession())).toBe(
      getSessionHydrationKey(createSession()),
    );
  });

  test("changes the hydration key when semantic session fields change", () => {
    const baseKey = getSessionHydrationKey(createSession());

    expect(getSessionHydrationKey(createSession({ role: "admin" }))).not.toBe(baseKey);
    expect(getSessionHydrationKey(createSession({
      emailVerified: new Date("2026-06-09T12:01:00.000Z"),
    }))).not.toBe(baseKey);
    expect(getSessionHydrationKey(createSession({
      updatedAt: new Date("2026-06-09T12:02:00.000Z"),
    }))).not.toBe(baseKey);
    expect(getSessionHydrationKey(createSession({ currentCredits: 10 }))).not.toBe(baseKey);
  });

  test("includes future session fields without hydrator-specific mapping", () => {
    const baseKey = getSessionHydrationKey(createSession());
    const sessionWithNewField = {
      ...createSession(),
      futureSessionVersionField: "enabled",
    } as SessionValidationResult;

    expect(getSessionHydrationKey(sessionWithNewField)).not.toBe(baseKey);
  });
});

function createSession({
  role = "user",
  emailVerified = null,
  updatedAt,
  currentCredits = 0,
}: CreateSessionOptions = {}) {
  const now = new Date("2026-06-09T12:00:00.000Z");

  return {
    id: "session-1",
    userId: "user-1",
    expiresAt: now.getTime() + 60_000,
    createdAt: now.getTime(),
    user: {
      id: "user-1",
      firstName: "Test",
      lastName: "User",
      email: "user@example.com",
      role,
      emailVerified,
      avatar: null,
      currentCredits,
      lastCreditRefreshAt: null,
      createdAt: now,
      updatedAt: updatedAt ?? now,
    },
  } satisfies SessionValidationResult;
}
