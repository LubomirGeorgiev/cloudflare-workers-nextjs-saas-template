/// <reference types="@cloudflare/vitest-plugin/types" />

// The seat preview (`seatUsage` from getTeamMemberManagementData) and the invite seat gate
// (`withinSeatCap` in team-writes.ts) are a JS form and a SQL form of one rule. This pins the pair
// against real D1: the preview says "full" exactly when the gate refuses a new invitation.

import { beforeEach, expect, test, vi } from "vitest";

// Request-scoped identity and email are the only mocks; see team-invitation-lifecycle.test.ts.
const { authState } = vi.hoisted(() => {
  const authState: { current: unknown } = { current: null };

  return { authState };
});

vi.mock("@/utils/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/auth")>()),
  requireVerifiedEmail: async () => authState.current,
  getCurrentSession: async () => authState.current,
}));

vi.mock("@/utils/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/email")>()),
  sendTeamInvitationEmail: vi.fn(async () => {}),
}));

vi.mock("@/i18n/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/i18n/locale", () => ({
  getUserLocale: async () => "en",
}));

import type Stripe from "stripe";
import { TEAM_PLANS, type TeamPlanId } from "@/constants/plans";
import { STRIPE_SUBSCRIPTION_TRANSITION_POLICY } from "@/constants/subscription-lifecycle";
import { SYSTEM_ROLES_ENUM } from "@/constants/team-roles";
import { getDB } from "@/db";
import { teamInvitationTable, teamMembershipTable, teamTable, userTable } from "@/db/schema";
import { generateInvitationToken, hashInvitationToken } from "@/lib/teams/invitation-tokens";
import { inviteUserToTeam } from "@/lib/teams/team-invite";
import { getTeamMemberManagementData } from "@/lib/teams/team-members";
import { normalizeEmail } from "@/lib/validation";
import { getTeamEntitlements } from "@/utils/entitlements";

const DAY_MS = 24 * 60 * 60 * 1000;

const db = getDB();

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

beforeEach(() => {
  authState.current = null;
});

test("the seat preview reports full exactly when the invite seat gate refuses", async () => {
  const { teamId, seats, ownerSession } = await seedTeamOneSeatBelowFull();
  authState.current = ownerSession;

  const before = await getTeamMemberManagementData(teamId);
  expect(before.seatUsage).toMatchObject({ used: seats - 1, limit: seats, isFull: false });

  await expect(inviteUserToTeam({
    teamId,
    email: normalizeEmail(`${uid("last_seat")}@example.com`),
    roleId: SYSTEM_ROLES_ENUM.MEMBER,
    isSystemRole: true,
  })).resolves.toEqual({ success: true });

  const after = await getTeamMemberManagementData(teamId);
  expect(after.seatUsage).toMatchObject({ used: seats, limit: seats, isFull: true });

  await expect(inviteUserToTeam({
    teamId,
    email: normalizeEmail(`${uid("over_cap")}@example.com`),
    roleId: SYSTEM_ROLES_ENUM.MEMBER,
    isSystemRole: true,
  })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});

// The plan with the fewest seats above one keeps the fixture small in forks with large plans.
function smallestMultiSeatPlan(): { planId: TeamPlanId; status: Stripe.Subscription.Status; seats: number } {
  let best: { planId: TeamPlanId; status: Stripe.Subscription.Status; seats: number } | null = null;

  for (const status of Object.keys(STRIPE_SUBSCRIPTION_TRANSITION_POLICY)) {
    for (const planId of Object.keys(TEAM_PLANS)) {
      const { isActive, limits } = getTeamEntitlements({
        planId,
        subscriptionStatus: status,
        planExpiresAt: null,
        addons: {},
      });

      if (isActive && limits.seats >= 2 && (!best || limits.seats < best.seats)) {
        best = { planId: planId as TeamPlanId, status, seats: limits.seats };
      }
    }
  }

  if (!best) {
    throw new Error("No plan grants 2 seats");
  }

  return best;
}

// The owner plus valid pending invitations fill all seats but one. An inactive member and an
// expired invitation hold no seat on either side, so they pin the two predicates as well.
async function seedTeamOneSeatBelowFull() {
  const { planId, status, seats } = smallestMultiSeatPlan();
  const ownerId = uid("usr_owner");
  const ownerEmail = `${uid("owner")}@example.com`;
  const inactiveUserId = uid("usr_inactive");
  const teamId = uid("team");

  await db.insert(userTable).values([
    { id: ownerId, email: ownerEmail, emailVerified: new Date() },
    { id: inactiveUserId, email: `${uid("inactive")}@example.com`, emailVerified: new Date() },
  ]);
  await db.insert(teamTable).values({
    id: teamId,
    name: "Seat Usage Team",
    slug: uid("seat-usage"),
    subscriptionPlanId: planId,
    subscriptionStatus: status,
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
      id: uid("tmem_inactive"),
      teamId,
      userId: inactiveUserId,
      roleId: SYSTEM_ROLES_ENUM.MEMBER,
      isSystemRole: 1,
      invitedBy: ownerId,
      joinedAt: new Date(),
      isActive: 0,
    },
  ]);

  const pendingCount = seats - 2;
  const invitationRows = await Promise.all(
    Array.from({ length: pendingCount + 1 }, async (_, index) => ({
      id: uid("tinv"),
      teamId,
      email: normalizeEmail(`${uid("pending")}@example.com`),
      roleId: SYSTEM_ROLES_ENUM.MEMBER,
      isSystemRole: 1,
      token: await hashInvitationToken(generateInvitationToken()),
      invitedBy: ownerId,
      // The last row is the expired one.
      expiresAt: new Date(Date.now() + (index < pendingCount ? DAY_MS : -DAY_MS)),
    })),
  );
  // One statement per row keeps each insert under the D1 bind limit when a fork has many seats.
  const [firstInsert, ...otherInserts] = invitationRows.map((row) => db.insert(teamInvitationTable).values(row));
  await db.batch([firstInsert, ...otherInserts]);

  return {
    teamId,
    seats,
    ownerSession: {
      id: `sess_${ownerId}`,
      userId: ownerId,
      user: { id: ownerId, email: ownerEmail, firstName: "Test", lastName: "User", emailVerified: new Date() },
    } as unknown,
  };
}
