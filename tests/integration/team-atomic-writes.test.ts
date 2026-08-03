/// <reference types="@cloudflare/vitest-pool-workers/types" />

// Public-boundary atomicity coverage for the team subsystem's race-safe write paths. The branch's
// whole point is that team creation, invitation, acceptance, seat capacity, trial reservation, and
// the subscription slot are enforced ATOMICALLY (conditional INSERT ... SELECT guards + unique
// indexes) so no read-then-write race can slip past a cap or duplicate a row. These tests drive the
// exported command functions (createTeam / inviteUserToTeam / acceptTeamInvitationById /
// removeTeamMember / acquireTrialAttempt / claimTeamSubscription) against a real D1 and fire
// genuinely concurrent calls with Promise.allSettled, asserting exactly-one-winner (or
// exactly-N-winner) outcomes. They deliberately do NOT assert on SQL-builder strings or internal
// statement shapes — only on observable end state — so they keep passing as the internals evolve and
// would FAIL if any of the atomic guards regressed.
//
// Mocking mirrors team-invitation-lifecycle.test.ts: request-scoped identity is injected because
// requireVerifiedEmail / getCurrentSession read next/headers cookies that don't exist in the
// Workers test pool. Every DB write, capacity guard, permission check, and unique index runs for
// real against Miniflare D1.

import { beforeEach, expect, test, vi } from "vitest";

const { authState, sendInvitationEmailMock } = vi.hoisted(() => ({
  authState: { current: null as unknown },
  sendInvitationEmailMock: vi.fn(async () => {}),
}));

vi.mock("@/utils/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/auth")>()),
  requireVerifiedEmail: async () => authState.current,
  getCurrentSession: async () => authState.current,
}));

vi.mock("@/utils/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/email")>()),
  sendTeamInvitationEmail: sendInvitationEmailMock,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/i18n/locale", () => ({
  getUserLocale: async () => "en",
}));

import type Stripe from "stripe";

import { getDB } from "@/db";
import {
  SYSTEM_ROLES_ENUM,
  teamMembershipTable,
  teamTable,
  userTable,
} from "@/db/schema";
import { MAX_TEAMS_CREATED_PER_USER, MAX_TEAMS_JOINED_PER_USER } from "@/constants";
import { TEAM_PLANS, type TeamPlanId } from "@/constants/plans";
import { STRIPE_SUBSCRIPTION_TRANSITION_POLICY } from "@/constants/subscription-lifecycle";
import { getTeamEntitlements } from "@/utils/entitlements";
import { normalizeEmail } from "@/lib/validation";
import { acquireTrialAttempt } from "@/lib/teams/trial-reservation";
import { claimTeamSubscription } from "@/utils/team-subscription";
import { createTeam } from "@/lib/teams/teams";
import { removeTeamMember } from "@/lib/teams/team-members";
import { inviteUserToTeam } from "@/lib/teams/team-invite";
import { acceptTeamInvitationById } from "@/lib/teams/team-invitation-accept";

const db = getDB();

// Unique fixture ids per call so each test is isolated (fresh ids, no cross-test ordering).
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

// Derive a plan + status that grants at least `minSeats` seats straight from the app's own
// plan/lifecycle config, so this stays correct in downstream templates that rename plans or change
// seat counts. Returns the resolved seat count too so tests can assert against the real cap.
function planGranting(minSeats: number): {
  planId: TeamPlanId;
  status: Stripe.Subscription.Status;
  seats: number;
} {
  for (const status of Object.keys(STRIPE_SUBSCRIPTION_TRANSITION_POLICY)) {
    for (const planId of Object.keys(TEAM_PLANS)) {
      const { isActive, limits } = getTeamEntitlements({
        planId,
        subscriptionStatus: status,
        planExpiresAt: null,
        addons: {},
      });
      if (isActive && limits.seats >= minSeats) {
        return {
          planId: planId as TeamPlanId,
          status: status as Stripe.Subscription.Status,
          seats: limits.seats,
        };
      }
    }
  }
  throw new Error(`No plan grants ${minSeats} seats`);
}

interface TeamFixture {
  teamId: string;
  ownerId: string;
  ownerSession: unknown;
  seats: number;
}

// A fresh team on a seat-granting plan with its active owner membership.
async function seedTeamWithOwner(minSeats = 2): Promise<TeamFixture> {
  const { planId, status, seats } = planGranting(minSeats);
  const ownerId = uid("usr_owner");
  const teamId = uid("team");
  const ownerEmail = `${uid("owner")}@example.com`;

  await db.insert(userTable).values({ id: ownerId, email: ownerEmail, emailVerified: new Date() });
  await db.insert(teamTable).values({
    id: teamId,
    name: "Atomic Team",
    slug: uid("atomic"),
    subscriptionPlanId: planId,
    subscriptionStatus: status,
  });
  await db.insert(teamMembershipTable).values({
    id: uid("tmem_owner"),
    teamId,
    userId: ownerId,
    roleId: SYSTEM_ROLES_ENUM.OWNER,
    isSystemRole: 1,
    invitedBy: ownerId,
    joinedAt: new Date(),
    isActive: 1,
  });

  return { teamId, ownerId, ownerSession: sessionFor({ id: ownerId, email: ownerEmail }), seats };
}

// A verified user account (needed as an invitee whenever a membership is created).
async function seedUser(): Promise<{ id: string; email: string; session: unknown }> {
  const id = uid("usr");
  const email = normalizeEmail(`${uid("user")}@example.com`);
  await db.insert(userTable).values({ id, email, emailVerified: new Date() });
  return { id, email, session: sessionFor({ id, email }) };
}

function inviteMemberAs(ownerSession: unknown, teamId: string, email: string) {
  authState.current = ownerSession;
  return inviteUserToTeam({
    teamId,
    email,
    roleId: SYSTEM_ROLES_ENUM.MEMBER,
    isSystemRole: true,
  });
}

function pendingInvitations(teamId: string) {
  return db.query.teamInvitationTable.findMany({
    where: { teamId, acceptedAt: { isNull: true } },
  });
}

function tally<T>(results: PromiseSettledResult<T>[]) {
  const fulfilled = results.filter(
    (r): r is PromiseFulfilledResult<T> => r.status === "fulfilled",
  );
  const rejected = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  return { fulfilled, rejected };
}

beforeEach(() => {
  authState.current = null;
  sendInvitationEmailMock.mockClear();
});

test("concurrent createTeam by one user never exceeds the owner cap (atomic owned-team guard)", async () => {
  const user = await seedUser();
  authState.current = user.session;

  // Fire more concurrent creations than the cap allows. The atomic INSERT ... SELECT owner-cap
  // guard must let exactly MAX_TEAMS_CREATED_PER_USER through; the rest fail with a create-limit
  // error. Distinct names keep slugs from colliding so only the cap is under test.
  const attempts = MAX_TEAMS_CREATED_PER_USER + 2;
  const results = await Promise.allSettled(
    Array.from({ length: attempts }, (_, i) =>
      createTeam({ name: `${uid("Team")}-${i}` }),
    ),
  );

  const { fulfilled } = tally(results);
  expect(fulfilled).toHaveLength(MAX_TEAMS_CREATED_PER_USER);

  // The database agrees: exactly cap-many owner memberships exist for this user.
  const owned = await db.query.teamMembershipTable.findMany({
    where: { userId: user.id, roleId: SYSTEM_ROLES_ENUM.OWNER, isSystemRole: 1 },
  });
  expect(owned).toHaveLength(MAX_TEAMS_CREATED_PER_USER);
});

test("concurrent invites to the SAME email yield exactly one pending invitation (unique-index race)", async () => {
  const f = await seedTeamWithOwner();
  const email = normalizeEmail(`${uid("dup")}@example.com`);

  // Many concurrent invites for the same (team, email). The partial unique index
  // (WHERE acceptedAt IS NULL) plus the uniform success shape must collapse them to one pending row.
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () => inviteMemberAs(f.ownerSession, f.teamId, email)),
  );

  const { fulfilled } = tally(results);
  expect(fulfilled.length).toBeGreaterThanOrEqual(1);

  const pending = await pendingInvitations(f.teamId);
  expect(pending).toHaveLength(1);
  expect(pending[0].email).toBe(email);
});

test("concurrent invites to DISTINCT emails stop exactly at the seat cap (atomic seat guard)", async () => {
  const f = await seedTeamWithOwner(2);
  // Owner already consumes 1 seat, so the plan's seats minus the owner is the number of invitations
  // that can ever be pending at once. Derived from the resolved plan so it is template-safe.
  const expectedWinners = f.seats - 1;

  const results = await Promise.allSettled(
    Array.from({ length: f.seats + 2 }, () =>
      inviteMemberAs(f.ownerSession, f.teamId, normalizeEmail(`${uid("seat")}@example.com`)),
    ),
  );

  const { fulfilled, rejected } = tally(results);
  expect(fulfilled).toHaveLength(expectedWinners);
  expect(rejected.length).toBe(f.seats + 2 - expectedWinners);

  const pending = await pendingInvitations(f.teamId);
  expect(pending).toHaveLength(expectedWinners);
});

test("concurrent acceptance of one invitation creates exactly one membership (uniqueness race)", async () => {
  const f = await seedTeamWithOwner();
  const invitee = await seedUser();

  await inviteMemberAs(f.ownerSession, f.teamId, invitee.email);
  const [pending] = await pendingInvitations(f.teamId);
  expect(pending).toBeTruthy();

  // The same invitee accepts the same invitation several times at once. The (teamId, userId) unique
  // index must let exactly one membership through; the losers surface a conflict rather than a
  // duplicate seat.
  authState.current = invitee.session;
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => acceptTeamInvitationById(pending.id)),
  );

  const { fulfilled } = tally(results);
  expect(fulfilled).toHaveLength(1);
  expect(fulfilled[0].value).toMatchObject({ success: true, teamId: f.teamId });

  const memberships = await db.query.teamMembershipTable.findMany({
    where: { teamId: f.teamId, userId: invitee.id },
  });
  expect(memberships).toHaveLength(1);
});

test("an inactive membership row does not consume a seat (active-only capacity counting)", async () => {
  const f = await seedTeamWithOwner(2);

  // Add enough INACTIVE members that, IF inactive rows counted toward capacity, the team would be
  // full (owner + inactive == seats). Because only active, unexpired memberships hold a seat, an
  // invite must still succeed.
  for (let i = 0; i < f.seats - 1; i++) {
    const ghost = await seedUser();
    await db.insert(teamMembershipTable).values({
      id: uid("tmem_inactive"),
      teamId: f.teamId,
      userId: ghost.id,
      roleId: SYSTEM_ROLES_ENUM.MEMBER,
      isSystemRole: 1,
      invitedBy: f.ownerId,
      joinedAt: new Date(),
      isActive: 0,
    });
  }

  const email = normalizeEmail(`${uid("active-only")}@example.com`);
  const result = await inviteMemberAs(f.ownerSession, f.teamId, email);
  expect(result).toEqual({ success: true });

  const pending = await pendingInvitations(f.teamId);
  expect(pending).toHaveLength(1);
  expect(pending[0].email).toBe(email);
});

test("accepting an invitation reactivates an inactive membership under the invitation role", async () => {
  const f = await seedTeamWithOwner();
  const invitee = await seedUser();

  // The invitee already has an INACTIVE membership carrying a stale custom role. Accepting a fresh
  // MEMBER invitation must reactivate that existing row (not insert a duplicate) and apply the
  // invitation's role, since the (teamId, userId) unique index forbids a second row.
  await db.insert(teamMembershipTable).values({
    id: uid("tmem_stale"),
    teamId: f.teamId,
    userId: invitee.id,
    roleId: "stale_custom_role",
    isSystemRole: 0,
    invitedBy: f.ownerId,
    joinedAt: new Date(),
    isActive: 0,
  });

  await inviteMemberAs(f.ownerSession, f.teamId, invitee.email);
  const [pending] = await pendingInvitations(f.teamId);
  expect(pending).toBeTruthy();

  authState.current = invitee.session;
  const accepted = await acceptTeamInvitationById(pending.id);
  expect(accepted).toMatchObject({ success: true, teamId: f.teamId });

  const memberships = await db.query.teamMembershipTable.findMany({
    where: { teamId: f.teamId, userId: invitee.id },
  });
  expect(memberships).toHaveLength(1);
  expect(Boolean(memberships[0].isActive)).toBe(true);
  expect(memberships[0].roleId).toBe(SYSTEM_ROLES_ENUM.MEMBER);
  expect(Boolean(memberships[0].isSystemRole)).toBe(true);

  const acceptedRow = await db.query.teamInvitationTable.findFirst({ where: { id: pending.id } });
  expect(acceptedRow?.acceptedAt).not.toBeNull();
});

test("concurrent inactive-membership reactivations share one joined-team slot atomically", async () => {
  const invitee = await seedUser();
  const targets = [await seedTeamWithOwner(), await seedTeamWithOwner()];

  // Leave exactly one active-membership slot, then create inactive rows and pending invitations
  // for two teams. Both acceptance requests race for that final slot.
  for (let i = 0; i < MAX_TEAMS_JOINED_PER_USER - 1; i++) {
    const fillerTeamId = uid("team_joined");
    await db.insert(teamTable).values({
      id: fillerTeamId,
      name: "Joined Team",
      slug: uid("joined"),
    });
    await db.insert(teamMembershipTable).values({
      id: uid("tmem_joined"),
      teamId: fillerTeamId,
      userId: invitee.id,
      roleId: SYSTEM_ROLES_ENUM.MEMBER,
      isSystemRole: 1,
      invitedBy: invitee.id,
      joinedAt: new Date(),
      isActive: 1,
    });
  }

  for (const target of targets) {
    await db.insert(teamMembershipTable).values({
      id: uid("tmem_inactive"),
      teamId: target.teamId,
      userId: invitee.id,
      roleId: SYSTEM_ROLES_ENUM.MEMBER,
      isSystemRole: 1,
      invitedBy: target.ownerId,
      joinedAt: new Date(),
      isActive: 0,
    });
    await inviteMemberAs(target.ownerSession, target.teamId, invitee.email);
  }

  const invitations = await Promise.all(targets.map(async (target) => {
    const [pending] = await pendingInvitations(target.teamId);
    expect(pending).toBeTruthy();
    return pending;
  }));

  authState.current = invitee.session;
  const results = await Promise.allSettled(
    invitations.map((invitation) => acceptTeamInvitationById(invitation.id)),
  );
  const { fulfilled, rejected } = tally(results);
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);

  const memberships = await db.query.teamMembershipTable.findMany({
    where: { userId: invitee.id },
  });
  const activeMemberships = memberships.filter((membership) =>
    Boolean(membership.isActive)
    && (!membership.expiresAt || membership.expiresAt > new Date())
  );
  expect(activeMemberships).toHaveLength(MAX_TEAMS_JOINED_PER_USER);

  const targetMemberships = memberships.filter((membership) =>
    targets.some((target) => target.teamId === membership.teamId)
  );
  expect(targetMemberships.filter((membership) => Boolean(membership.isActive))).toHaveLength(1);

  const persistedInvitations = await Promise.all(invitations.map((invitation) =>
    db.query.teamInvitationTable.findFirst({ where: { id: invitation.id } })
  ));
  expect(persistedInvitations.filter((invitation) => invitation?.acceptedAt)).toHaveLength(1);
  expect(persistedInvitations.filter((invitation) => !invitation?.acceptedAt)).toHaveLength(1);
});

test("invite -> accept -> remove -> re-invite works and re-adds a fresh membership", async () => {
  const f = await seedTeamWithOwner();
  const invitee = await seedUser();

  await inviteMemberAs(f.ownerSession, f.teamId, invitee.email);
  const [firstPending] = await pendingInvitations(f.teamId);

  authState.current = invitee.session;
  await acceptTeamInvitationById(firstPending.id);

  authState.current = f.ownerSession;
  await removeTeamMember({ teamId: f.teamId, userId: invitee.id });
  const afterRemove = await db.query.teamMembershipTable.findMany({
    where: { teamId: f.teamId, userId: invitee.id },
  });
  expect(afterRemove).toHaveLength(0);

  // Re-invite the removed member: a fresh pending row is created (accepted history never shadows
  // it) and can be accepted again.
  const reInvite = await inviteMemberAs(f.ownerSession, f.teamId, invitee.email);
  expect(reInvite).toEqual({ success: true });
  const [secondPending] = await pendingInvitations(f.teamId);
  expect(secondPending.id).not.toBe(firstPending.id);

  authState.current = invitee.session;
  const reAccepted = await acceptTeamInvitationById(secondPending.id);
  expect(reAccepted).toMatchObject({ success: true, teamId: f.teamId });

  const memberships = await db.query.teamMembershipTable.findMany({
    where: { teamId: f.teamId, userId: invitee.id },
  });
  expect(memberships).toHaveLength(1);
});

test("concurrent identical trial attempts converge on one resumable reservation", async () => {
  const f = await seedTeamWithOwner();
  const params = {
    teamId: f.teamId,
    userId: f.ownerId,
    setupIntentId: uid("seti"),
    planId: "trial-plan",
    interval: "month",
    customerId: uid("cus"),
    paymentMethodId: uid("pm"),
    priceId: uid("price"),
    trialDays: 14,
  };

  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      acquireTrialAttempt(params),
    ),
  );

  const { fulfilled } = tally(results);
  expect(fulfilled).toHaveLength(5);
  expect(fulfilled.every((result) => result.value !== null)).toBe(true);
  expect(new Set(fulfilled.map((result) => result.value?.id)).size).toBe(1);
  expect(fulfilled.filter((result) => result.value?.isResume === false)).toHaveLength(1);
  expect(fulfilled.filter((result) => result.value?.isResume === true)).toHaveLength(4);

  const resumedAfterConfigChange = await acquireTrialAttempt({
    ...params,
    priceId: uid("price"),
    trialDays: 30,
  });
  expect(resumedAfterConfigChange).toMatchObject({
    id: fulfilled[0].value?.id,
    priceId: params.priceId,
    trialDays: params.trialDays,
    isResume: true,
  });

  const mismatchedRetry = await acquireTrialAttempt({
    ...params,
    setupIntentId: uid("seti"),
  });
  expect(mismatchedRetry).toBeNull();
});

test("one user reserving trials on two teams at once wins on exactly one (per-user gate)", async () => {
  const owner = await seedUser();
  const teamA = uid("team");
  const teamB = uid("team");
  await db.insert(teamTable).values([
    { id: teamA, name: "A", slug: uid("a") },
    { id: teamB, name: "B", slug: uid("b") },
  ]);

  // The per-user unique index closes the trial-farming race: one owner starting trials on several
  // owned teams in parallel wins only the first.
  const results = await Promise.allSettled([
    acquireTrialAttempt({
      teamId: teamA,
      userId: owner.id,
      setupIntentId: uid("seti"),
      planId: "trial-plan",
      interval: "month",
      customerId: uid("cus"),
      paymentMethodId: uid("pm"),
      priceId: uid("price"),
      trialDays: 14,
    }),
    acquireTrialAttempt({
      teamId: teamB,
      userId: owner.id,
      setupIntentId: uid("seti"),
      planId: "trial-plan",
      interval: "month",
      customerId: uid("cus"),
      paymentMethodId: uid("pm"),
      priceId: uid("price"),
      trialDays: 14,
    }),
  ]);

  const { fulfilled } = tally(results);
  const winners = fulfilled.filter((result) => result.value !== null);
  expect(winners).toHaveLength(1);
});

test("concurrent subscription-slot claims elect exactly one subscription", async () => {
  const teamId = uid("team");
  await db.insert(teamTable).values({ id: teamId, name: "Sub", slug: uid("sub") });

  // Two concurrent checkouts each create a subscription; the conditional WHERE-null claim must
  // elect exactly one winner so the team never binds to two subscriptions.
  const results = await Promise.allSettled([
    claimTeamSubscription({ teamId, subscriptionId: "sub_first" }),
    claimTeamSubscription({ teamId, subscriptionId: "sub_second" }),
  ]);

  const { fulfilled } = tally(results);
  const wins = fulfilled.filter((r) => r.value === true);
  expect(wins).toHaveLength(1);

  const team = await db.query.teamTable.findFirst({ where: { id: teamId } });
  expect(["sub_first", "sub_second"]).toContain(team?.stripeSubscriptionId);
});
