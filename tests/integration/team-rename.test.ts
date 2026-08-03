/// <reference types="@cloudflare/vitest-pool-workers/types" />

// Behavior coverage for renaming a team against a real D1. The invariant under test is that a
// rename changes ONLY the display name: `slug` is the team's URL and must survive untouched, so
// bookmarks, shared links, and in-flight invitation emails keep resolving. Permission enforcement
// runs for real through requireTeamPermission -> live D1 membership, not the KV session.
//
// Mocking mirrors team-atomic-writes.test.ts: request-scoped identity is injected because
// requireVerifiedEmail reads next/headers cookies that don't exist in the Workers test pool, and
// Stripe is stubbed because there is no live account here. The KV session refresh and the
// scheduler enqueue are stubbed for the same reason the Stripe stub exists: they are the rename's
// other post-commit side effects, and only a stub can make them fail on demand.

import { beforeEach, expect, test, vi } from "vitest";

const {
  authState,
  stripeCustomerUpdateMock,
  getStripeMock,
  updateAllSessionsOfUserMock,
  enqueueTeamSessionsRefreshMock,
} = vi.hoisted(() => {
  const stripeCustomerUpdateMock = vi.fn(async () => ({}));

  return {
    authState: { current: null as unknown },
    stripeCustomerUpdateMock,
    // Indirection so a test can make getStripe() itself throw synchronously (misconfigured keys).
    getStripeMock: vi.fn(() => ({ customers: { update: stripeCustomerUpdateMock } })),
    updateAllSessionsOfUserMock: vi.fn(async (__userId: string) => {}),
    enqueueTeamSessionsRefreshMock: vi.fn(async (__teamId: string) => {}),
  };
});

vi.mock("@/utils/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/auth")>()),
  requireVerifiedEmail: async () => authState.current,
  getCurrentSession: async () => authState.current,
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: getStripeMock,
}));

vi.mock("@/utils/kv-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/kv-session")>()),
  updateAllSessionsOfUser: updateAllSessionsOfUserMock,
}));

vi.mock("@/lib/scheduler/enqueue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scheduler/enqueue")>()),
  enqueueTeamSessionsRefresh: enqueueTeamSessionsRefreshMock,
}));

import { getDB } from "@/db";
import {
  SYSTEM_ROLES_ENUM,
  teamMembershipTable,
  teamTable,
  userTable,
} from "@/db/schema";
import { TEAM_NAME_MAX_LENGTH } from "@/constants";
import { renameTeam } from "@/lib/teams/teams";

const db = getDB();

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

function sessionFor(user: { id: string; email: string }) {
  return {
    id: `sess_${user.id}`,
    userId: user.id,
    user: {
      id: user.id,
      email: user.email,
      firstName: "Test",
      lastName: "User",
      emailVerified: new Date(),
    },
  } as unknown;
}

interface SeededTeam {
  teamId: string;
  slug: string;
  name: string;
  ownerSession: unknown;
  memberSession: unknown;
}

// A team with an active owner and an active plain member, so permission gating is exercised
// against two real memberships rather than a missing one.
async function seedTeam({
  name = "Original Name",
  stripeCustomerId,
}: { name?: string; stripeCustomerId?: string } = {}): Promise<SeededTeam> {
  const teamId = uid("team");
  const slug = uid("slug");
  const ownerId = uid("usr_owner");
  const memberId = uid("usr_member");
  const ownerEmail = `${uid("owner")}@example.com`;
  const memberEmail = `${uid("member")}@example.com`;

  await db.insert(userTable).values([
    { id: ownerId, email: ownerEmail, emailVerified: new Date() },
    { id: memberId, email: memberEmail, emailVerified: new Date() },
  ]);
  await db.insert(teamTable).values({ id: teamId, name, slug, stripeCustomerId });
  await db.insert(teamMembershipTable).values([
    {
      id: uid("tmem_owner"),
      teamId,
      userId: ownerId,
      roleId: SYSTEM_ROLES_ENUM.OWNER,
      isSystemRole: 1,
      joinedAt: new Date(),
      isActive: 1,
    },
    {
      id: uid("tmem_member"),
      teamId,
      userId: memberId,
      roleId: SYSTEM_ROLES_ENUM.MEMBER,
      isSystemRole: 1,
      joinedAt: new Date(),
      isActive: 1,
    },
  ]);

  return {
    teamId,
    slug,
    name,
    ownerSession: sessionFor({ id: ownerId, email: ownerEmail }),
    memberSession: sessionFor({ id: memberId, email: memberEmail }),
  };
}

function readTeam(teamId: string) {
  return db.query.teamTable.findFirst({ where: { id: teamId } });
}

beforeEach(() => {
  authState.current = null;
  stripeCustomerUpdateMock.mockClear();
  getStripeMock.mockClear();
  updateAllSessionsOfUserMock.mockClear();
  enqueueTeamSessionsRefreshMock.mockClear();
});

test("owner renames the team and the slug is left untouched", async () => {
  const team = await seedTeam();
  authState.current = team.ownerSession;

  const result = await renameTeam({ teamId: team.teamId, name: "Renamed Team" });

  expect(result.name).toBe("Renamed Team");
  expect(result.slug).toBe(team.slug);

  const stored = await readTeam(team.teamId);
  expect(stored?.name).toBe("Renamed Team");
  expect(stored?.slug).toBe(team.slug);
});

test("a non-owner member cannot rename and the team row is unchanged", async () => {
  const team = await seedTeam();
  authState.current = team.memberSession;

  await expect(renameTeam({ teamId: team.teamId, name: "Hijacked" })).rejects.toThrow();

  const stored = await readTeam(team.teamId);
  expect(stored?.name).toBe(team.name);
  expect(stored?.slug).toBe(team.slug);
});

test("renaming one team to another team's exact name keeps both slugs distinct", async () => {
  const teamA = await seedTeam({ name: "Team A" });
  const teamB = await seedTeam({ name: "Team B" });

  authState.current = teamA.ownerSession;
  await renameTeam({ teamId: teamA.teamId, name: "Team B" });

  const [storedA, storedB] = await Promise.all([readTeam(teamA.teamId), readTeam(teamB.teamId)]);

  // Names may collide freely; slugs are the unique identity and neither moved.
  expect(storedA?.name).toBe("Team B");
  expect(storedB?.name).toBe("Team B");
  expect(storedA?.slug).toBe(teamA.slug);
  expect(storedB?.slug).toBe(teamB.slug);
  expect(storedA?.slug).not.toBe(storedB?.slug);
});

test("a name at the maximum length is accepted", async () => {
  const team = await seedTeam();
  authState.current = team.ownerSession;
  const maxLengthName = "a".repeat(TEAM_NAME_MAX_LENGTH);

  await renameTeam({ teamId: team.teamId, name: maxLengthName });

  const stored = await readTeam(team.teamId);
  expect(stored?.name).toBe(maxLengthName);
});

test("renaming a team with a Stripe customer syncs the customer name", async () => {
  const team = await seedTeam({ stripeCustomerId: uid("cus") });
  authState.current = team.ownerSession;

  await renameTeam({ teamId: team.teamId, name: "Billing Name" });

  expect(stripeCustomerUpdateMock).toHaveBeenCalledWith(expect.any(String), { name: "Billing Name" });
});

test("a Stripe failure does not fail or roll back the rename", async () => {
  const team = await seedTeam({ stripeCustomerId: uid("cus") });
  authState.current = team.ownerSession;
  stripeCustomerUpdateMock.mockRejectedValueOnce(new Error("stripe is down"));

  await expect(renameTeam({ teamId: team.teamId, name: "Survives Stripe" })).resolves.toMatchObject({
    name: "Survives Stripe",
  });

  const stored = await readTeam(team.teamId);
  expect(stored?.name).toBe("Survives Stripe");
});

// The follow-ups run as an array of promises, so a SYNCHRONOUS getStripe() throw (bad keys) would
// escape past the per-step .catch() if the sync call were not wrapped in an async function.
test("a synchronous Stripe client failure does not fail the committed rename", async () => {
  const team = await seedTeam({ stripeCustomerId: uid("cus") });
  authState.current = team.ownerSession;
  getStripeMock.mockImplementationOnce(() => {
    throw new Error("stripe is not configured");
  });

  await expect(renameTeam({ teamId: team.teamId, name: "Survives Sync Throw" })).resolves.toMatchObject({
    name: "Survives Sync Throw",
  });

  const stored = await readTeam(team.teamId);
  expect(stored?.name).toBe("Survives Sync Throw");
});

test("a queue enqueue failure does not fail the committed rename", async () => {
  const team = await seedTeam();
  authState.current = team.ownerSession;
  enqueueTeamSessionsRefreshMock.mockRejectedValueOnce(new Error("queue is down"));

  await expect(renameTeam({ teamId: team.teamId, name: "Survives Queue" })).resolves.toMatchObject({
    name: "Survives Queue",
  });

  expect(enqueueTeamSessionsRefreshMock).toHaveBeenCalledWith(team.teamId);

  const stored = await readTeam(team.teamId);
  expect(stored?.name).toBe("Survives Queue");
  expect(stored?.slug).toBe(team.slug);
});

test("a session-refresh failure does not fail the committed rename", async () => {
  const team = await seedTeam();
  authState.current = team.ownerSession;
  updateAllSessionsOfUserMock.mockRejectedValueOnce(new Error("kv is down"));

  await expect(renameTeam({ teamId: team.teamId, name: "Survives KV" })).resolves.toMatchObject({
    name: "Survives KV",
  });

  // The out-of-band fan-out still runs: the follow-ups are independent, not chained.
  expect(enqueueTeamSessionsRefreshMock).toHaveBeenCalledWith(team.teamId);

  const stored = await readTeam(team.teamId);
  expect(stored?.name).toBe("Survives KV");
  expect(stored?.slug).toBe(team.slug);
});

// A nonexistent team has no membership row, so the permission gate rejects it before the update
// ever runs: the failure is FORBIDDEN, not the NOT_FOUND that only a delete race can reach.
test("renaming a team that does not exist is rejected by the permission gate", async () => {
  const team = await seedTeam();
  authState.current = team.ownerSession;

  await expect(renameTeam({ teamId: uid("team_missing"), name: "Ghost" }))
    .rejects.toMatchObject({ code: "FORBIDDEN" });
});
