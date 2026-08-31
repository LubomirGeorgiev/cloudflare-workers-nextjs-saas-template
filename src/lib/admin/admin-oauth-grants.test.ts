// Demotion has to reach the grant half of a user's internal credentials, not only their keys, and
// it has to do so without fanning every grant out at once — a Worker has a subrequest budget.

import { beforeEach, expect, test, vi } from "vitest";

const { listConnectedAppsForUserMock, revokeConnectedAppForUserMock } = vi.hoisted(() => ({
  listConnectedAppsForUserMock: vi.fn(),
  revokeConnectedAppForUserMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/oauth/connected-apps", () => ({
  listConnectedApps: vi.fn(),
  listConnectedAppsForUser: listConnectedAppsForUserMock,
  revokeConnectedAppForUser: revokeConnectedAppForUserMock,
}));

vi.mock("@/utils/auth", () => ({
  requireAdmin: async () => undefined,
  requireVerifiedEmail: async () => ({ userId: "usr_admin" }),
}));

const { ADMIN_SCOPE_NAMES } = await import("@/lib/api/admin-scopes");
const { API_SCOPE_NAMES } = await import("@/lib/api/scopes");
const { revokeInternalOAuthGrantsForUser } = await import("@/lib/admin/admin-oauth-grants");

// Derived from the catalogs, never spelled out: a fork renames scopes and these tests still hold.
const INTERNAL_SCOPE = ADMIN_SCOPE_NAMES[0];
const PUBLIC_SCOPE = API_SCOPE_NAMES[0];
// The batch size is private to the module, so the bound asserted here is a ceiling, not the value.
const MAX_CONCURRENT_REVOCATIONS = 10;

function grant({ grantId, scopes }: { grantId: string; scopes: string[] }) {
  return { grantId, clientId: `cli_${grantId}`, scopes };
}

beforeEach(() => {
  vi.clearAllMocks();
  revokeConnectedAppForUserMock.mockResolvedValue(undefined);
});

test("revokes only the grants carrying an internal scope, scoped to the demoted user", async () => {
  listConnectedAppsForUserMock.mockResolvedValue([
    grant({ grantId: "gr_public", scopes: [PUBLIC_SCOPE] }),
    grant({ grantId: "gr_internal", scopes: [PUBLIC_SCOPE, INTERNAL_SCOPE] }),
  ]);

  await expect(revokeInternalOAuthGrantsForUser("usr_1")).resolves.toBe(1);

  expect(revokeConnectedAppForUserMock).toHaveBeenCalledTimes(1);
  expect(revokeConnectedAppForUserMock).toHaveBeenCalledWith({
    grantId: "gr_internal",
    userId: "usr_1",
  });
});

test("revokes nothing when the user holds no internal grant", async () => {
  listConnectedAppsForUserMock.mockResolvedValue([
    grant({ grantId: "gr_public", scopes: [PUBLIC_SCOPE] }),
  ]);

  await expect(revokeInternalOAuthGrantsForUser("usr_1")).resolves.toBe(0);

  expect(revokeConnectedAppForUserMock).not.toHaveBeenCalled();
});

test("keeps the revocation fan-out bounded over a long grant list", async () => {
  listConnectedAppsForUserMock.mockResolvedValue(
    Array.from({ length: 60 }, (_, index) =>
      grant({ grantId: `gr_${index}`, scopes: [INTERNAL_SCOPE] })),
  );

  let inFlight = 0;
  let peakInFlight = 0;

  revokeConnectedAppForUserMock.mockImplementation(async () => {
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    await Promise.resolve();
    inFlight -= 1;
  });

  await expect(revokeInternalOAuthGrantsForUser("usr_1")).resolves.toBe(60);

  expect(revokeConnectedAppForUserMock).toHaveBeenCalledTimes(60);
  expect(peakInFlight).toBeLessThanOrEqual(MAX_CONCURRENT_REVOCATIONS);
});
