import { beforeEach, describe, expect, test, vi } from "vitest";

import { CURRENT_OAUTH_GRANT_CACHE_VERSION } from "@/constants";

const {
  fakeSpan,
  loadPrincipalIdentityMock,
  putGrantSnapshotMock,
  readGrantSnapshotMock,
  spanAttributes,
} = vi.hoisted(() => {
  const attributes = new Map<string, unknown>();
  const span = {
    isTraced: true,
    recordException: vi.fn(),
    setAttribute: vi.fn(),
    setAttributes: vi.fn((values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) {
        attributes.set(key, value);
      }

      return span;
    }),
  };

  return {
    fakeSpan: span,
    loadPrincipalIdentityMock: vi.fn(),
    putGrantSnapshotMock: vi.fn(),
    readGrantSnapshotMock: vi.fn(),
    spanAttributes: attributes,
  };
});

vi.mock("server-only", () => ({}));

// Keeps the real `tracePrincipalResolve`, which reaches the fake span through the trace mock.
vi.mock("@/utils/kv-principal-cache", async (importOriginal) => ({
  tracePrincipalResolve: (await importOriginal<typeof import("@/utils/kv-principal-cache")>())
    .tracePrincipalResolve,
  deleteGrantSnapshot: vi.fn(),
  getGrantGenerationKey: vi.fn(),
  getPrincipalCacheKV: vi.fn(),
  loadPrincipalIdentity: loadPrincipalIdentityMock,
  putGrantSnapshot: putGrantSnapshotMock,
  readGrantSnapshot: readGrantSnapshotMock,
  reviveUserDates: (user: unknown) => user,
}));

vi.mock("@/utils/trace", () => ({
  withSpan: ({ run }: { run: (span: typeof fakeSpan) => Promise<unknown> }) => run(fakeSpan),
  recordSpanException: vi.fn(),
}));

const { getOAuthGrantPrincipal } = await import("@/utils/kv-oauth-grant");

const USER_ID = "user_grant_owner";
const GRANT_ID = "grant_1";
const CACHE_ATTRIBUTE = "app.auth.principal.cache";
const OUTCOME_ATTRIBUTE = "app.auth.principal.outcome";
const USER = { id: USER_ID, email: "agent@example.com" };

describe("OAuth grant principal resolve span", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spanAttributes.clear();
    readGrantSnapshotMock.mockResolvedValue({ snapshot: null, generation: null });
    loadPrincipalIdentityMock.mockResolvedValue({ user: USER, teams: [] });
  });

  test("tags a usable snapshot as a cache hit", async () => {
    readGrantSnapshotMock.mockResolvedValue({
      snapshot: {
        version: CURRENT_OAUTH_GRANT_CACHE_VERSION,
        userId: USER_ID,
        user: USER,
        teams: [],
      },
      generation: null,
    });

    const principal = await getOAuthGrantPrincipal(props({ grantId: GRANT_ID }));

    expect(principal?.userId).toBe(USER_ID);
    expect(loadPrincipalIdentityMock).not.toHaveBeenCalled();
    expect(spanAttributes.get("app.auth.principal.credential_kind")).toBe("oauth_grant");
    expect(spanAttributes.get(CACHE_ATTRIBUTE)).toBe("hit");
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("ok");
  });

  test("tags a rebuild from D1 as a miss that resolved", async () => {
    const principal = await getOAuthGrantPrincipal(props({ grantId: GRANT_ID }));

    expect(principal?.userId).toBe(USER_ID);
    expect(putGrantSnapshotMock).toHaveBeenCalledOnce();
    expect(spanAttributes.get(CACHE_ATTRIBUTE)).toBe("miss");
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("ok");
  });

  test("tags a token without a grant id as a cache bypass", async () => {
    await getOAuthGrantPrincipal(props({}));

    expect(readGrantSnapshotMock).not.toHaveBeenCalled();
    expect(spanAttributes.get(CACHE_ATTRIBUTE)).toBe("bypass");
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("ok");
  });

  test("tags a grant whose owner is banned", async () => {
    loadPrincipalIdentityMock.mockResolvedValue({
      user: { ...USER, bannedAt: new Date() },
      teams: [],
    });

    const principal = await getOAuthGrantPrincipal(props({ grantId: GRANT_ID }));

    expect(principal).toBeNull();
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("banned");
  });

  test("tags a grant whose owner no longer exists", async () => {
    loadPrincipalIdentityMock.mockResolvedValue(null);

    const principal = await getOAuthGrantPrincipal(props({ grantId: GRANT_ID }));

    expect(principal).toBeNull();
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("user_not_found");
  });

  test("tags props without a user as malformed", async () => {
    const principal = await getOAuthGrantPrincipal({ ...props({}), userId: "" });

    expect(principal).toBeNull();
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("malformed");
    expect(spanAttributes.get(CACHE_ATTRIBUTE)).toBeUndefined();
  });
});

function props({ grantId }: { grantId?: string }) {
  return {
    credentialKind: "oauth-grant" as const,
    userId: USER_ID,
    clientId: "client_1",
    grantId,
    scopes: [],
  };
}
