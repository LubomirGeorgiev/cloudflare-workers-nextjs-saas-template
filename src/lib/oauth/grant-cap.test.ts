// The grant cap decides what a consent silently disconnects, so its boundary is the whole contract:
// one slot must be free for the grant about to be created, and the app that goes must be the one
// connected first. The consent screen and the approval path share one selector, so an off-by-one
// here would warn about one app and disconnect another.

import { expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/oauth/provider-api", () => ({ getOAuthHelpers: vi.fn() }));

// Names come from D1; the cap never needs them, so an empty map keeps this test on the boundary.
vi.mock("@/lib/oauth/oauth-apps", () => ({
  getOAuthAppsByClientIds: async () => new Map(),
}));

vi.mock("@/utils/auth", () => ({ requireVerifiedEmail: vi.fn() }));
vi.mock("@/utils/kv-oauth-grant", () => ({ deleteOAuthGrantCache: vi.fn() }));

const { MAX_OAUTH_GRANTS_PER_USER } = await import("@/constants");
const { selectGrantCapEvictions } = await import("@/lib/oauth/connected-apps");
type ConnectedApp = ReturnType<typeof selectGrantCapEvictions>["evicted"][number];

// No seeded app uses it, so the selector sees a client connecting for the first time.
const NEW_CLIENT_ID = "client_new";

function buildApp({ index, clientId }: { index: number; clientId?: string }): ConnectedApp {
  return {
    grantId: `grant_${index}`,
    clientId: clientId ?? `client_${index}`,
    name: null,
    logoUri: null,
    isVerified: false,
    scopes: ["profile:read"],
    grantedAt: (index + 1) * 1000,
  };
}

// `grantedAt` ascending with the index, so grant 0 is always the oldest. The list the selector
// takes is newest first, exactly as `listConnectedAppsForUser` returns it.
function buildApps(count: number): ConnectedApp[] {
  return Array.from({ length: count }, (_, index) => buildApp({ index })).reverse();
}

test("an account with room loses nothing", () => {
  const selection = selectGrantCapEvictions({
    apps: buildApps(MAX_OAUTH_GRANTS_PER_USER - 2),
    clientId: NEW_CLIENT_ID,
  });

  expect(selection.evicted).toEqual([]);
  expect(selection.replaced).toEqual([]);
});

// The last free slot: the incoming grant fills the account exactly, so nothing has to go yet.
test("the grant that exactly fills the account evicts nothing", () => {
  const selection = selectGrantCapEvictions({
    apps: buildApps(MAX_OAUTH_GRANTS_PER_USER - 1),
    clientId: NEW_CLIENT_ID,
  });

  expect(selection.evicted).toEqual([]);
});

test("a full account gives up the app connected first, and only that one", () => {
  const { evicted } = selectGrantCapEvictions({
    apps: buildApps(MAX_OAUTH_GRANTS_PER_USER),
    clientId: NEW_CLIENT_ID,
  });

  expect(evicted).toHaveLength(1);
  expect(evicted[0].grantId).toBe("grant_0");
});

// An account already past the cap — grants predating it, or a cap a fork lowered — drains to the
// same place in one consent rather than staying over the limit forever.
test("an account over the cap drains to exactly one free slot", () => {
  const excess = 5;

  const { evicted } = selectGrantCapEvictions({
    apps: buildApps(MAX_OAUTH_GRANTS_PER_USER + excess),
    clientId: NEW_CLIENT_ID,
  });

  expect(evicted).toHaveLength(excess + 1);
  // Oldest first, so the warning lists them in the order they will go.
  expect(evicted.map((app) => app.grantId)).toEqual(
    Array.from({ length: excess + 1 }, (_, index) => `grant_${index}`),
  );
});

// The selector sorts for itself, so a caller that lists in another order still evicts the oldest.
test("an unsorted list still gives up the oldest apps first", () => {
  const excess = 3;
  const apps = buildApps(MAX_OAUTH_GRANTS_PER_USER + excess);
  // A deterministic scramble: neither newest first nor oldest first.
  const unsorted = [...apps.filter((_, index) => index % 2 === 0), ...apps.filter((_, index) => index % 2 === 1)];

  const { evicted } = selectGrantCapEvictions({ apps: unsorted, clientId: NEW_CLIENT_ID });

  expect(evicted.map((app) => app.grantId)).toEqual(
    Array.from({ length: excess + 1 }, (_, index) => `grant_${index}`),
  );
});

// Every consent mints a grant, so a client that reconnects must replace its own rather than add
// one. These two tests are the guard against one client evicting the whole account.
test("a client already connected replaces its own grant, so nothing else goes", () => {
  const { replaced, evicted } = selectGrantCapEvictions({
    apps: buildApps(MAX_OAUTH_GRANTS_PER_USER),
    clientId: "client_3",
  });

  expect(evicted).toEqual([]);
  expect(replaced.map((app) => app.grantId)).toEqual(["grant_3"]);
});

// Grants for one client stacked up before the cap existed. Every one is replaced, and none of them
// counts as overflow, so the eviction still comes from the other apps alone.
test("a pile of grants for the same client is all replaced and never counted as overflow", () => {
  const pile = MAX_OAUTH_GRANTS_PER_USER + 10;
  const others = buildApps(MAX_OAUTH_GRANTS_PER_USER);
  const mine = Array.from(
    { length: pile },
    (_, index) => buildApp({ index: MAX_OAUTH_GRANTS_PER_USER + index, clientId: "client_pile" }),
  );

  const { replaced, evicted } = selectGrantCapEvictions({
    apps: [...mine, ...others],
    clientId: "client_pile",
  });

  expect(replaced).toHaveLength(pile);
  expect(evicted.map((app) => app.grantId)).toEqual(["grant_0"]);
});
