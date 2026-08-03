import { describe, expect, test, vi } from "vitest";

import { ActionError } from "@/lib/action-error";
import type { ApiKeyPrincipal } from "@/lib/api/principal";
import { API_SCOPE_NAMES } from "@/lib/api/scopes";

vi.mock("server-only", () => ({}));

const {
  assertAccountAudience,
  assertTeamAudience,
  getBearerPrincipal,
  getAudienceTeamId,
  hasScope,
  isApiPrincipal,
  isTeamInAudience,
  principalToSession,
  requireScope,
  runWithPrincipal,
  toApiAudience,
} = await import("@/lib/api/principal");

const [readScope, writeScope] = API_SCOPE_NAMES;

function buildPrincipal(overrides: Partial<ApiKeyPrincipal> = {}): ApiKeyPrincipal {
  return {
    kind: "api-key",
    userId: "user-1",
    keyId: "akey_1",
    user: {
      id: "user-1",
      email: "agent@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      role: "user",
      emailVerified: new Date("2026-01-01T00:00:00.000Z"),
      avatar: null,
      preferredLocale: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    } as ApiKeyPrincipal["user"],
    teams: [],
    scopes: [readScope],
    audience: { type: "personal" },
    ...overrides,
  };
}

describe("principal AsyncLocalStorage context", () => {
  test("has no principal outside a run", () => {
    expect(getBearerPrincipal()).toBeUndefined();
  });

  test("exposes the principal inside the run and clears it afterwards", async () => {
    const principal = buildPrincipal();

    const seen = await runWithPrincipal(principal, async () => {
      await Promise.resolve();
      return getBearerPrincipal();
    });

    expect(seen).toBe(principal);
    expect(getBearerPrincipal()).toBeUndefined();
  });

  test("keeps concurrent runs isolated from each other", async () => {
    const first = buildPrincipal({ userId: "user-1", keyId: "akey_1" });
    const second = buildPrincipal({ userId: "user-2", keyId: "akey_2" });

    const [firstSeen, secondSeen] = await Promise.all([
      runWithPrincipal(first, async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 5);
        });
        return getBearerPrincipal()?.userId;
      }),
      runWithPrincipal(second, async () => getBearerPrincipal()?.userId),
    ]);

    expect(firstSeen).toBe("user-1");
    expect(secondSeen).toBe("user-2");
  });
});

describe("scope guards", () => {
  // Unrestricted is the *absence* of a principal (a cookie caller never enters the ALS), never a
  // wildcard value on one: a credential in scope always carries an explicit list.
  test("an empty scope list grants nothing rather than everything", () => {
    const principal = buildPrincipal({ scopes: [] });

    for (const scope of API_SCOPE_NAMES) {
      expect(hasScope(principal, scope)).toBe(false);
    }
  });

  test("grants only the scopes the credential actually holds", () => {
    const principal = buildPrincipal({ scopes: [readScope] });

    expect(hasScope(principal, readScope)).toBe(true);
    expect(hasScope(principal, writeScope)).toBe(false);
  });

  test("requireScope returns the principal when the scope is held", async () => {
    const principal = buildPrincipal({ scopes: [readScope] });

    const resolved = await runWithPrincipal(principal, async () => requireScope(readScope));

    expect(resolved).toBe(principal);
  });

  test("requireScope rejects a credential missing the scope", async () => {
    const principal = buildPrincipal({ scopes: [readScope] });

    await runWithPrincipal(principal, async () => {
      expect(() => requireScope(writeScope)).toThrowError(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );
    });
  });

  test("requireScope fails closed when no principal is in scope", () => {
    let thrown: unknown;

    try {
      requireScope(readScope);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ActionError);
    expect((thrown as ActionError).code).toBe("NOT_AUTHORIZED");
  });
});

describe("audience guards", () => {
  const TEAM_ID = "team_own";
  const OTHER_TEAM_ID = "team_other";

  function teamPrincipal() {
    return buildPrincipal({ audience: toApiAudience(TEAM_ID) });
  }

  test("derives the audience from the credential's stored team", () => {
    expect(toApiAudience(null)).toEqual({ type: "personal" });
    expect(toApiAudience(undefined)).toEqual({ type: "personal" });
    expect(toApiAudience(TEAM_ID)).toEqual({ type: "team", teamId: TEAM_ID });
  });

  test("reports no audience team outside a run and for a personal credential", async () => {
    expect(getAudienceTeamId()).toBeNull();
    expect(isTeamInAudience(TEAM_ID)).toBe(true);

    await runWithPrincipal(buildPrincipal(), async () => {
      expect(getAudienceTeamId()).toBeNull();
      expect(isTeamInAudience(TEAM_ID)).toBe(true);
      expect(() => assertTeamAudience(TEAM_ID)).not.toThrow();
      expect(() => assertAccountAudience()).not.toThrow();
    });
  });

  test("confines a team credential to its own team", async () => {
    await runWithPrincipal(teamPrincipal(), async () => {
      expect(getAudienceTeamId()).toBe(TEAM_ID);
      expect(isTeamInAudience(TEAM_ID)).toBe(true);
      expect(isTeamInAudience(OTHER_TEAM_ID)).toBe(false);

      expect(() => assertTeamAudience(TEAM_ID)).not.toThrow();
      expect(() => assertTeamAudience(OTHER_TEAM_ID)).toThrowError(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );
    });
  });

  // Fail closed: a team-audience route that somehow carries no team id must not pass unchecked.
  test("refuses a team credential when no team is addressed at all", async () => {
    await runWithPrincipal(teamPrincipal(), async () => {
      expect(() => assertTeamAudience(undefined)).toThrowError(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );
    });
  });

  test("keeps a team credential out of account-level operations", async () => {
    await runWithPrincipal(teamPrincipal(), async () => {
      let thrown: unknown;

      try {
        assertAccountAudience();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ActionError);
      // The audience team travels with the refusal so the mapper can name it to an agent.
      expect(thrown).toMatchObject({ code: "FORBIDDEN", messageParams: { teamId: TEAM_ID } });
    });
  });
});

// The only thing standing between a malformed props blob out of the provider's KV and a principal
// every downstream guard trusts, so each variant's required fields are asserted individually.
describe("isApiPrincipal", () => {
  test("accepts a well-formed principal of either kind", () => {
    expect(isApiPrincipal(buildPrincipal())).toBe(true);
    expect(isApiPrincipal({
      ...buildPrincipal(),
      kind: "oauth-grant",
      keyId: undefined,
      clientId: "https://client.example",
    })).toBe(true);
  });

  test("rejects anything that is not an object", () => {
    for (const value of [null, undefined, "principal", 42, []]) {
      expect(isApiPrincipal(value)).toBe(false);
    }
  });

  test("rejects an unknown or missing credential kind", () => {
    expect(isApiPrincipal({ ...buildPrincipal(), kind: "session" })).toBe(false);
    expect(isApiPrincipal({ ...buildPrincipal(), kind: undefined })).toBe(false);
  });

  test("rejects a variant missing the field that identifies it", () => {
    expect(isApiPrincipal({ ...buildPrincipal(), keyId: undefined })).toBe(false);
    expect(isApiPrincipal({ ...buildPrincipal(), keyId: "" })).toBe(false);
    expect(isApiPrincipal({
      ...buildPrincipal(),
      kind: "oauth-grant",
      clientId: undefined,
    })).toBe(false);
  });

  test("rejects a principal whose identity or permission fields are malformed", () => {
    expect(isApiPrincipal({ ...buildPrincipal(), userId: "" })).toBe(false);
    expect(isApiPrincipal({ ...buildPrincipal(), user: undefined })).toBe(false);
    expect(isApiPrincipal({ ...buildPrincipal(), teams: undefined })).toBe(false);
    expect(isApiPrincipal({ ...buildPrincipal(), scopes: null })).toBe(false);
  });

  test("rejects a malformed audience, including a team audience with no team", () => {
    expect(isApiPrincipal({ ...buildPrincipal(), audience: undefined })).toBe(false);
    expect(isApiPrincipal({ ...buildPrincipal(), audience: { type: "everyone" } })).toBe(false);
    expect(isApiPrincipal({ ...buildPrincipal(), audience: { type: "team" } })).toBe(false);
  });
});

describe("principalToSession", () => {
  test("produces a session-shaped snapshot with derived initials", () => {
    const principal = buildPrincipal();

    const session = principalToSession(principal);

    expect(session.userId).toBe(principal.userId);
    expect(session.user.email).toBe(principal.user.email);
    expect(session.user.initials).toBe("AL");
    expect(session.teams).toBe(principal.teams);
  });

  test("leaves the KV-storage fields null instead of inventing them", () => {
    const session = principalToSession(buildPrincipal({ keyId: "akey_1" }));

    expect(session.id).toBeNull();
    expect(session.createdAt).toBeNull();
    expect(session.expiresAt).toBeNull();
  });
});
