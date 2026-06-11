import { afterEach, describe, expect, test, vi } from "vitest";

const refreshMock = vi.hoisted(() => vi.fn());
const storeMocks = vi.hoisted(() => {
  interface SessionState {
    session: unknown;
    isLoading: boolean;
    lastFetched: Date | null;
    hasHydratedSessionFromServer: boolean;
    setSession: (session: unknown) => void;
    clearSession: () => void;
    refetchSession: () => void;
  }

  let sessionState: SessionState;

  function resetSessionState() {
    sessionState = {
      session: null,
      isLoading: true,
      lastFetched: null,
      hasHydratedSessionFromServer: false,
      setSession: (session) => {
        sessionState = {
          ...sessionState,
          session,
          isLoading: false,
          lastFetched: new Date(),
        };
      },
      clearSession: () => {
        sessionState = {
          ...sessionState,
          session: null,
          isLoading: false,
          lastFetched: null,
          hasHydratedSessionFromServer: false,
        };
      },
      refetchSession: () => {
        sessionState = {
          ...sessionState,
          isLoading: true,
        };
      },
    };
  }

  resetSessionState();

  return {
    getSessionState: () => sessionState,
    reset: () => {
      resetSessionState();
    },
  };
});

vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

vi.mock("@/state/session", () => ({
  useSessionStore: Object.assign(
    (selector: (state: ReturnType<typeof storeMocks.getSessionState>) => unknown) => (
      selector(storeMocks.getSessionState())
    ),
    {
      getState: storeMocks.getSessionState,
    },
  ),
}));

const { useFetchSession } = await import("./use-fetch-session");

describe("useFetchSession", () => {
  afterEach(() => {
    storeMocks.reset();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    Reflect.deleteProperty(globalThis, "document");
  });

  test("skips anonymous initial session fetch when no session cookie exists", async () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        cookie: "",
      },
    });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      session: null,
    })));

    vi.stubGlobal("fetch", fetchMock);

    const fetchSession = useFetchSession();

    await fetchSession({ reason: "initial" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(storeMocks.getSessionState()).toMatchObject({
      session: null,
      isLoading: false,
    });
  });
});
