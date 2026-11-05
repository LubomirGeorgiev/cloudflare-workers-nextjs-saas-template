/// <reference types="@cloudflare/vitest-plugin/types" />

// A removed member must not get back in through a pending invitation for their own address.
// Runs the real invite, remove, and accept services against real D1.

import { beforeEach, expect, test, vi } from "vitest";

// Request-scoped identity and email are the only mocks; see team-invitation-lifecycle.test.ts.
// The accept hooks only pause the real accept at a fixed point, so a test can race a write in.
const { authState, sendInvitationEmailMock, acceptHooks } = vi.hoisted(() => {
  const authState: { current: unknown } = { current: null };
  const acceptHooks: AcceptHooks = { afterInvitationRead: null, afterMembershipRead: null };

  return {
    authState,
    sendInvitationEmailMock: vi.fn(async () => {}),
    acceptHooks,
  };
});

vi.mock("@/utils/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/auth")>()),
  requireVerifiedEmail: async () => authState.current,
  getCurrentSession: async () => authState.current,
}));

vi.mock("@/utils/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/email")>()),
  sendTeamInvitationEmail: sendInvitationEmailMock,
}));

// The accept path checks the blocklist after its invitation read and resolves the role after its
// membership read. Neither runs on the invite path while a hook is set.
vi.mock("@/lib/auth/blocked-email-guard", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth/blocked-email-guard")>();

  return {
    ...original,
    assertEmailNotBlocked: async (...args: Parameters<typeof original.assertEmailNotBlocked>) => {
      await acceptHooks.afterInvitationRead?.();
      return original.assertEmailNotBlocked(...args);
    },
  };
});

vi.mock("@/lib/teams/team-invitation-roles", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/teams/team-invitation-roles")>();

  return {
    ...original,
    resolveInvitationRole: async (...args: Parameters<typeof original.resolveInvitationRole>) => {
      await acceptHooks.afterMembershipRead?.();
      return original.resolveInvitationRole(...args);
    },
  };
});

vi.mock("@/i18n/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/i18n/locale", () => ({
  getUserLocale: async () => "en",
}));

import { SYSTEM_ROLES_ENUM, TEAM_PERMISSIONS } from "@/constants/team-roles";
import { getDB } from "@/db";
import {
  teamInvitationTable,
  teamMembershipTable,
  teamRoleTable,
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
import {
  acceptTeamInvitationById,
  acceptTeamInvitationByToken,
} from "@/lib/teams/team-invitation-accept";
import { generateInvitationToken, hashInvitationToken } from "@/lib/teams/invitation-tokens";
import { eq } from "drizzle-orm";

const DAY_MS = 24 * 60 * 60 * 1000;

const db = getDB();

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

beforeEach(() => {
  authState.current = null;
  sendInvitationEmailMock.mockClear();
  acceptHooks.afterInvitationRead = null;
  acceptHooks.afterMembershipRead = null;
});

test("a removed member cannot rejoin through a pending invitation for their own address", async () => {
  const f = await seedFixture();

  // M holds invite_members through a custom role and invites their own address.
  authState.current = f.memberSession;
  await expect(inviteUserToTeam({
    teamId: f.teamId,
    email: f.memberEmail,
    roleId: SYSTEM_ROLES_ENUM.MEMBER,
    isSystemRole: true,
  })).resolves.toEqual({ success: true });

  const [selfInvitation] = await pendingInvitationsFor(f);
  expect(selfInvitation).toBeTruthy();

  authState.current = f.ownerSession;
  await removeTeamMember({ teamId: f.teamId, userId: f.memberId });
  expect(await membershipOf(f)).toBeFalsy();
  expect(await pendingInvitationsFor(f)).toHaveLength(0);

  authState.current = f.memberSession;
  await expect(acceptTeamInvitationById(selfInvitation.id))
    .rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await membershipOf(f)).toBeFalsy();
});

test("removal also ends a legacy mixed-case invitation, and leaves other addresses alone", async () => {
  const f = await seedFixture();
  const rawToken = generateInvitationToken();
  const otherEmail = normalizeEmail(`${uid("other")}@example.com`);

  await db.insert(teamInvitationTable).values([
    {
      id: uid("tinv_legacy"),
      teamId: f.teamId,
      email: ` ${f.memberEmail.toUpperCase()} `,
      roleId: SYSTEM_ROLES_ENUM.MEMBER,
      isSystemRole: 1,
      token: await hashInvitationToken(rawToken),
      invitedBy: f.memberId,
      expiresAt: new Date(Date.now() + DAY_MS),
    },
    {
      id: uid("tinv_other"),
      teamId: f.teamId,
      email: otherEmail,
      roleId: SYSTEM_ROLES_ENUM.MEMBER,
      isSystemRole: 1,
      token: await hashInvitationToken(generateInvitationToken()),
      invitedBy: f.memberId,
      expiresAt: new Date(Date.now() + DAY_MS),
    },
  ]);

  authState.current = f.ownerSession;
  await removeTeamMember({ teamId: f.teamId, userId: f.memberId });

  authState.current = f.memberSession;
  await expect(acceptTeamInvitationByToken(rawToken))
    .rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await membershipOf(f)).toBeFalsy();

  const otherInvitation = await db.query.teamInvitationTable.findFirst({
    where: { teamId: f.teamId, email: otherEmail, acceptedAt: { isNull: true } },
  });
  expect(otherInvitation).toBeTruthy();
});

test("a fresh invitation after removal still lets the removed member rejoin", async () => {
  const f = await seedFixture();

  authState.current = f.ownerSession;
  await removeTeamMember({ teamId: f.teamId, userId: f.memberId });

  await expect(inviteUserToTeam({
    teamId: f.teamId,
    email: f.memberEmail,
    roleId: SYSTEM_ROLES_ENUM.MEMBER,
    isSystemRole: true,
  })).resolves.toEqual({ success: true });
  const [freshInvitation] = await pendingInvitationsFor(f);
  expect(freshInvitation).toBeTruthy();

  authState.current = f.memberSession;
  await expect(acceptTeamInvitationById(freshInvitation.id))
    .resolves.toMatchObject({ success: true, teamId: f.teamId });
  expect(await membershipOf(f)).toBeTruthy();
});

test("a removal that lands after accept reads the invitation refuses the membership insert", async () => {
  const f = await seedFixture();

  authState.current = f.memberSession;
  await inviteUserToTeam({
    teamId: f.teamId,
    email: f.memberEmail,
    roleId: SYSTEM_ROLES_ENUM.MEMBER,
    isSystemRole: true,
  });
  const [selfInvitation] = await pendingInvitationsFor(f);
  expect(selfInvitation).toBeTruthy();

  // The owner removes M while M's accept holds the invitation it already read.
  acceptHooks.afterInvitationRead = async () => {
    acceptHooks.afterInvitationRead = null;
    authState.current = f.ownerSession;
    await removeTeamMember({ teamId: f.teamId, userId: f.memberId });
    authState.current = f.memberSession;
  };

  await expect(acceptTeamInvitationById(selfInvitation.id))
    .rejects.toMatchObject({ code: "NOT_FOUND", messageKey: "Client.Dashboard.Teams.errorInvitationNotFound" });
  expect(await membershipOf(f)).toBeFalsy();
});

test("an invitation that expires mid-accept refuses the insert with the expiry error", async () => {
  const f = await seedFixture();

  authState.current = f.ownerSession;
  await removeTeamMember({ teamId: f.teamId, userId: f.memberId });
  await inviteUserToTeam({
    teamId: f.teamId,
    email: f.memberEmail,
    roleId: SYSTEM_ROLES_ENUM.MEMBER,
    isSystemRole: true,
  });
  const [invitation] = await pendingInvitationsFor(f);

  acceptHooks.afterInvitationRead = async () => {
    await db.update(teamInvitationTable)
      .set({ expiresAt: new Date(Date.now() - DAY_MS) })
      .where(eq(teamInvitationTable.id, invitation.id));
  };

  authState.current = f.memberSession;
  await expect(acceptTeamInvitationById(invitation.id))
    .rejects.toMatchObject({ messageKey: "Client.Dashboard.Teams.errorInvitationExpired" });
  expect(await membershipOf(f)).toBeFalsy();
});

test("a revoke that lands mid-reactivation reports the invitation as gone, not the join limit", async () => {
  const f = await seedFixture();

  authState.current = f.ownerSession;
  await inviteUserToTeam({
    teamId: f.teamId,
    email: f.memberEmail,
    roleId: SYSTEM_ROLES_ENUM.MEMBER,
    isSystemRole: true,
  });
  const [invitation] = await pendingInvitationsFor(f);
  await db.update(teamMembershipTable)
    .set({ isActive: 0 })
    .where(eq(teamMembershipTable.userId, f.memberId));

  acceptHooks.afterMembershipRead = async () => {
    await db.delete(teamInvitationTable).where(eq(teamInvitationTable.id, invitation.id));
  };

  authState.current = f.memberSession;
  await expect(acceptTeamInvitationById(invitation.id))
    .rejects.toMatchObject({ code: "NOT_FOUND", messageKey: "Client.Dashboard.Teams.errorInvitationNotFound" });
  expect(await membershipOf(f)).toMatchObject({ isActive: 0 });
});

async function membershipOf(f: Fixture) {
  return db.query.teamMembershipTable.findFirst({
    where: { teamId: f.teamId, userId: f.memberId },
  });
}

async function pendingInvitationsFor(f: Fixture) {
  return db.query.teamInvitationTable.findMany({
    where: { teamId: f.teamId, email: f.memberEmail, acceptedAt: { isNull: true } },
  });
}

// A team with free seats, its owner, and member M on a custom role that holds invite_members.
async function seedFixture(minSeats = 3): Promise<Fixture> {
  const { planId, status } = planGranting(minSeats);
  const ownerId = uid("usr_owner");
  const memberId = uid("usr_member");
  const teamId = uid("team");
  const roleId = uid("trole_inviter");
  const ownerEmail = normalizeEmail(`${uid("owner")}@example.com`);
  const memberEmail = normalizeEmail(`${uid("member")}@example.com`);

  await db.insert(userTable).values([
    { id: ownerId, email: ownerEmail, emailVerified: new Date() },
    { id: memberId, email: memberEmail, emailVerified: new Date() },
  ]);
  await db.insert(teamTable).values({
    id: teamId,
    name: "Removal Team",
    slug: uid("removal"),
    subscriptionPlanId: planId,
    subscriptionStatus: status,
  });
  await db.insert(teamRoleTable).values({
    id: roleId,
    teamId,
    name: "Inviter",
    permissions: [TEAM_PERMISSIONS.ACCESS_DASHBOARD, TEAM_PERMISSIONS.INVITE_MEMBERS],
  });
  await db.insert(teamMembershipTable).values([
    {
      id: uid("tmem_owner"),
      teamId,
      userId: ownerId,
      roleId: SYSTEM_ROLES_ENUM.OWNER,
      isSystemRole: 1,
      invitedBy: ownerId,
      joinedAt: new Date(),
      isActive: 1,
    },
    {
      id: uid("tmem_member"),
      teamId,
      userId: memberId,
      roleId,
      isSystemRole: 0,
      invitedBy: ownerId,
      joinedAt: new Date(),
      isActive: 1,
    },
  ]);

  return {
    teamId,
    ownerId,
    ownerSession: sessionFor({ id: ownerId, email: ownerEmail }),
    memberId,
    memberEmail,
    memberSession: sessionFor({ id: memberId, email: memberEmail }),
  };
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

// Derive a seat-granting plan from config, so forks that rename plans or seat counts still pass.
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
        return { planId: planId as TeamPlanId, status };
      }
    }
  }
  throw new Error(`No plan grants ${minSeats} seats`);
}

interface AcceptHooks {
  afterInvitationRead: (() => Promise<void>) | null;
  afterMembershipRead: (() => Promise<void>) | null;
}

interface Fixture {
  teamId: string;
  ownerId: string;
  ownerSession: unknown;
  memberId: string;
  memberEmail: string;
  memberSession: unknown;
}
