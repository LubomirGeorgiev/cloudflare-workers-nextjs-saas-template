import { afterEach, describe, expect, test, vi } from "vitest";

import type { SessionValidationResult } from "@/types";

vi.mock("server-only", () => ({}));

const { useSessionStore } = await import("./session");

const initialState = useSessionStore.getInitialState();

describe("session store hydration", () => {
  afterEach(() => {
    useSessionStore.setState(initialState, true);
    vi.useRealTimers();
  });

  test("hydrates a server session without leaving the client in a loading state", () => {
    vi.useFakeTimers();
    const now = new Date("2026-05-29T12:00:00.000Z");
    vi.setSystemTime(now);

    const session = createSession({ now });

    useSessionStore.getState().hydrateSessionFromServer(session);

    expect(useSessionStore.getState()).toMatchObject({
      session,
      isLoading: false,
      lastFetched: now,
      hasHydratedSessionFromServer: true,
    });
  });

  test("tracks client-fetched sessions separately from server-hydrated sessions", () => {
    const session = createSession({
      now: new Date("2026-05-29T12:00:00.000Z"),
    });

    useSessionStore.getState().setSession(session);

    expect(useSessionStore.getState()).toMatchObject({
      session,
      isLoading: false,
      hasHydratedSessionFromServer: false,
    });
  });

  test("clearing the session resets the server hydration marker", () => {
    const session = createSession({
      now: new Date("2026-05-29T12:00:00.000Z"),
    });

    useSessionStore.getState().hydrateSessionFromServer(session);
    useSessionStore.getState().clearSession();

    expect(useSessionStore.getState()).toMatchObject({
      session: null,
      isLoading: false,
      lastFetched: null,
      hasHydratedSessionFromServer: false,
    });
  });
});

function createSession({ now }: { now: Date }) {
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
      role: "user",
      emailVerified: null,
      avatar: null,
      currentCredits: 0,
      lastCreditRefreshAt: null,
      createdAt: now,
      updatedAt: now,
    },
  } satisfies SessionValidationResult;
}
