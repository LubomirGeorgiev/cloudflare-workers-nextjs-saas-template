/// <reference types="@cloudflare/vitest-pool-workers/types" />

// Public-boundary coverage for the invitation lifecycle, exercised through the real command
// functions (inviteUserToTeam / acceptTeamInvitationById / removeTeamMember) against real D1 —
// NOT the raw SQL builders (those are pinned in team-atomic-writes.test.ts). The focus is the
// "re-invite poison" regression: the (teamId, email) uniqueness must be scoped to PENDING
// invitations (partial unique index WHERE acceptedAt IS NULL) so a member removed after accepting
// can still be re-invited, while accepted history is preserved and never shadows a new invite.
// The harness applies src/db/migrations/, including
// 20260722180349_team_security_hardening (team_invitation_team_email_pending_unique).

import { beforeEach, expect, test, vi } from "vitest";

// Request-scoped identity is injected here: requireVerifiedEmail/getCurrentSession normally read
// next/headers cookies, which don't exist in the Workers test pool. Everything else in the module
// Permission checks and DB writes run for real.
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

// getTranslations / getUserLocale also depend on request context; the invite path only uses them
// for fallback email copy + a locale that is handed to the (mocked) email sender.
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/i18n/locale", () => ({
  getUserLocale: async () => "en",
}));

import { getDB } from "@/db";
import {
  SYSTEM_ROLES_ENUM,
  teamMembershipTable,
  teamTable,
  userTable,
} from "@/db/schema";
import type Stripe from "stripe";
import { TEAM_PLANS, type TeamPlanId } from "@/constants/plans";
import { STRIPE_SUBSCRIPTION_TRANSITION_POLICY } from "@/constants/subscription-lifecycle";
import { getTeamEntitlements } from "@/utils/entitlements";
import { normalizeEmail } from "@/lib/validation";
import { removeTeamMember } from "@/lib/teams/team-members";
import { inviteUserToTeam } from "@/lib/teams/team-invite";
import { acceptTeamInvitationById } from "@/lib/teams/team-invitation-accept";
import { revokeTeamInvitation } from "@/lib/teams/team-invitation-revoke";

const db = getDB();

// Unique fixture ids per call so each test is isolated (no order-coupling with other tests).
let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

// Minimal KVSession-shaped identity for the mocked auth layer. Only the fields the invitation
// commands actually read are populated.
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

// Derive a plan + subscription status that grants at least `minSeats` seats, straight from the
// app's own plan/lifecycle config so this stays correct in downstream templates that rename plans,
// change seat counts, or adjust lifecycle policy. The free plan only has 1 seat, so inviting even a
// single member past the owner needs an active paid plan.
function planGranting(minSeats: number): { planId: TeamPlanId; status: Stripe.Subscription.Status } {
  for (const status of Object.keys(STRIPE_SUBSCRIPTION_TRANSITION_POLICY)) {
    for (const planId of Object.keys(TEAM_PLANS)) {
      const { isActive, limits } = getTeamEntitlements({
        planId,
        subscriptionStatus: status,
        planExpiresAt: null,
        addons: {},
      });
      if (isActive && limits.seats >= minSeats) {
        return { planId: planId as TeamPlanId, status: status as Stripe.Subscription.Status };
      }
    }
  }
  throw new Error(`No plan grants ${minSeats} seats`);
}

interface Fixture {
  teamId: string;
  teamSlug: string;
  ownerId: string;
  ownerSession: unknown;
  inviteeId: string;
  inviteeEmail: string;
  inviteeSession: unknown;
}

// Isolated per-test fixture: a fresh team on a seat-granting plan with its owner, plus a separate
// invitee user account (verified email, so acceptance can succeed).
async function seedFixture(minSeats = 2): Promise<Fixture> {
  const { planId, status } = planGranting(minSeats);
  const ownerId = uid("usr_owner");
  const teamId = uid("team");
  const teamSlug = uid("lifecycle");
  const inviteeId = uid("usr_invitee");
  const inviteeEmail = normalizeEmail(`${uid("invitee")}@example.com`);
  const ownerEmail = `${uid("owner")}@example.com`;

  await db.insert(userTable).values([
    { id: ownerId, email: ownerEmail, emailVerified: new Date() },
    { id: inviteeId, email: inviteeEmail, emailVerified: new Date() },
  ]);
  await db.insert(teamTable).values({
    id: teamId,
    name: "Lifecycle Team",
    slug: teamSlug,
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

  return {
    teamId,
    teamSlug,
    ownerId,
    ownerSession: sessionFor({ id: ownerId, email: ownerEmail }),
    inviteeId,
    inviteeEmail,
    inviteeSession: sessionFor({ id: inviteeId, email: inviteeEmail }),
  };
}

function invitationsFor(teamId: string, email: string) {
  return db.query.teamInvitationTable.findMany({
    where: { teamId, email },
  });
}

async function inviteAsOwner(f: Fixture) {
  authState.current = f.ownerSession;
  return inviteUserToTeam({
    teamId: f.teamId,
    email: f.inviteeEmail,
    roleId: SYSTEM_ROLES_ENUM.MEMBER,
    isSystemRole: true,
  });
}

beforeEach(() => {
  authState.current = null;
  sendInvitationEmailMock.mockClear();
});

test("invite -> accept -> remove -> re-invite creates a usable NEW pending invitation", async () => {
  const f = await seedFixture();

  // 1. Invite: one pending row, one email sent.
  const firstInvite = await inviteAsOwner(f);
  expect(firstInvite).toEqual({ success: true });
  expect(sendInvitationEmailMock).toHaveBeenCalledTimes(1);

  const afterInvite = await invitationsFor(f.teamId, f.inviteeEmail);
  expect(afterInvite).toHaveLength(1);
  expect(afterInvite[0].acceptedAt).toBeNull();
  const firstInvitationId = afterInvite[0].id;

  // 2. Accept as the invitee.
  authState.current = f.inviteeSession;
  const accepted = await acceptTeamInvitationById(firstInvitationId);
  expect(accepted).toMatchObject({
    success: true,
    teamId: f.teamId,
    teamSlug: f.teamSlug,
  });

  const membership = await db.query.teamMembershipTable.findFirst({
    where: { teamId: f.teamId, userId: f.inviteeId },
  });
  expect(membership).toBeTruthy();

  const acceptedRow = await db.query.teamInvitationTable.findFirst({
    where: { id: firstInvitationId },
  });
  expect(acceptedRow?.acceptedAt).not.toBeNull();

  // 3. Remove the member.
  authState.current = f.ownerSession;
  await removeTeamMember({ teamId: f.teamId, userId: f.inviteeId });
  const removed = await db.query.teamMembershipTable.findFirst({
    where: { teamId: f.teamId, userId: f.inviteeId },
  });
  expect(removed).toBeFalsy();

  // 4. Re-invite: a fresh pending row must be created and a new email sent — the accepted row must
  //    not silently short-circuit the invite (the "re-invite poison" regression).
  sendInvitationEmailMock.mockClear();
  const reInvite = await inviteAsOwner(f);
  expect(reInvite).toEqual({ success: true });
  expect(sendInvitationEmailMock).toHaveBeenCalledTimes(1);

  const all = await invitationsFor(f.teamId, f.inviteeEmail);
  expect(all).toHaveLength(2);

  const pending = all.filter((row) => row.acceptedAt === null);
  const acceptedHistory = all.filter((row) => row.acceptedAt !== null);
  expect(pending).toHaveLength(1);
  expect(acceptedHistory).toHaveLength(1);

  // The new pending invitation is a distinct, usable row (fresh token + future expiry).
  const newPending = pending[0];
  expect(newPending.id).not.toBe(firstInvitationId);
  expect(newPending.token).toBeTruthy();
  expect(newPending.expiresAt).not.toBeNull();
  expect(new Date(newPending.expiresAt as Date).getTime()).toBeGreaterThan(Date.now());
});

test("a second invite while one is pending resends without creating a duplicate pending row", async () => {
  const f = await seedFixture();

  await inviteAsOwner(f);
  const afterFirst = await invitationsFor(f.teamId, f.inviteeEmail);
  expect(afterFirst).toHaveLength(1);
  const invitationId = afterFirst[0].id;
  expect(sendInvitationEmailMock).toHaveBeenCalledTimes(1);

  // Second invite while the first is still pending (not expired): the existing row is refreshed and
  // re-sent, never duplicated.
  await inviteAsOwner(f);
  expect(sendInvitationEmailMock).toHaveBeenCalledTimes(2);

  const afterSecond = await invitationsFor(f.teamId, f.inviteeEmail);
  expect(afterSecond).toHaveLength(1);
  expect(afterSecond[0].id).toBe(invitationId);
  const stillPending = afterSecond.filter((row) => row.acceptedAt === null);
  expect(stillPending).toHaveLength(1);
});

test("only the team owner can revoke a pending invitation and invalidate its token", async () => {
  const f = await seedFixture(3);
  await inviteAsOwner(f);

  const [pendingInvitation] = await invitationsFor(f.teamId, f.inviteeEmail);
  expect(pendingInvitation).toBeTruthy();

  const memberId = uid("usr_member");
  const memberEmail = `${uid("member")}@example.com`;
  await db.insert(userTable).values({
    id: memberId,
    email: memberEmail,
    emailVerified: new Date(),
  });
  await db.insert(teamMembershipTable).values({
    id: uid("tmem_member"),
    teamId: f.teamId,
    userId: memberId,
    roleId: SYSTEM_ROLES_ENUM.MEMBER,
    isSystemRole: 1,
    invitedBy: f.ownerId,
    joinedAt: new Date(),
    isActive: 1,
  });

  authState.current = sessionFor({ id: memberId, email: memberEmail });
  await expect(revokeTeamInvitation({
    teamId: f.teamId,
    invitationId: pendingInvitation.id,
  })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await invitationsFor(f.teamId, f.inviteeEmail)).toHaveLength(1);

  authState.current = f.ownerSession;
  await expect(revokeTeamInvitation({
    teamId: f.teamId,
    invitationId: pendingInvitation.id,
  })).resolves.toEqual({ success: true });
  expect(await invitationsFor(f.teamId, f.inviteeEmail)).toHaveLength(0);

  authState.current = f.inviteeSession;
  await expect(acceptTeamInvitationById(pendingInvitation.id))
    .rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("accepted historical rows do not block re-invites (partial index: many accepted, one pending)", async () => {
  const f = await seedFixture();

  // Two full invite -> accept -> remove cycles accumulate two accepted (historical) rows for the
  // same (teamId, email). A full unique index would reject the second cycle's insert; the partial
  // index (WHERE acceptedAt IS NULL) permits accepted duplicates.
  for (let cycle = 0; cycle < 2; cycle++) {
    await inviteAsOwner(f);

    const pendingRow = await db.query.teamInvitationTable.findFirst({
      where: { teamId: f.teamId, email: f.inviteeEmail, acceptedAt: { isNull: true } },
    });
    expect(pendingRow).toBeTruthy();

    authState.current = f.inviteeSession;
    await acceptTeamInvitationById((pendingRow as { id: string }).id);

    authState.current = f.ownerSession;
    await removeTeamMember({ teamId: f.teamId, userId: f.inviteeId });
  }

  const afterCycles = await invitationsFor(f.teamId, f.inviteeEmail);
  expect(afterCycles.filter((row) => row.acceptedAt !== null)).toHaveLength(2);

  // A third invite still creates exactly one new pending row alongside the two accepted rows.
  await inviteAsOwner(f);
  const finalRows = await invitationsFor(f.teamId, f.inviteeEmail);
  expect(finalRows.filter((row) => row.acceptedAt === null)).toHaveLength(1);
  expect(finalRows.filter((row) => row.acceptedAt !== null)).toHaveLength(2);
  expect(finalRows).toHaveLength(3);
});
