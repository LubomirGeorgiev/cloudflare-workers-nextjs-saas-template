/// <reference types="@cloudflare/vitest-plugin/types" />

// The staff limit overrides of one team against real D1: the seat gate and the seat counter read
// the override, and a lower limit removes no member.

import { beforeEach, describe, expect, test, vi } from "vitest";

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

import { eq } from "drizzle-orm";

import { TEAM_LIMIT_OVERRIDE_BOUNDS } from "@/constants/limit-overrides";
import { DEFAULT_PLAN_ID, TEAM_PLANS, TEAM_PLAN_IDS, getPlan, type TeamPlanId } from "@/constants/plans";
import { SYSTEM_ROLES_ENUM } from "@/constants/team-roles";
import { getDB } from "@/db";
import { teamMembershipTable, teamTable, userTable } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { loadTeamLimitOverrides, setTeamLimitOverridesAsStaff } from "@/lib/admin/team-limit-overrides";
import { inviteUserToTeam } from "@/lib/teams/team-invite";
import { getTeamMemberManagementData } from "@/lib/teams/team-members";
import { normalizeEmail } from "@/lib/validation";

const db = getDB();
const STAFF_USER_ID = "usr_staff_limit_overrides";
const REASON = "Integration test";
const FREE_LIMITS = getPlan(DEFAULT_PLAN_ID).limits;
// A plan with room to lower the seat limit below two members. Undefined in a fork with no such plan.
const MULTI_SEAT_PLAN_ID: TeamPlanId | undefined = TEAM_PLAN_IDS.find(
  (id) => TEAM_PLANS[id].limits.seats > TEAM_LIMIT_OVERRIDE_BOUNDS.seats.min + 1,
);
// The Free plan has room for a raise of one seat.
const CAN_RAISE_FREE_SEATS = FREE_LIMITS.seats < TEAM_LIMIT_OVERRIDE_BOUNDS.seats.max;

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

beforeEach(() => {
  authState.current = null;
});

// A team with its owner, and `extraMembers` more active members. The owner session is the actor.
async function seedTeam({
  planId = DEFAULT_PLAN_ID,
  isActive = false,
  extraMembers = 0,
}: {
  planId?: TeamPlanId;
  isActive?: boolean;
  extraMembers?: number;
} = {}): Promise<string> {
  const teamId = uid("team_limit_overrides");
  const userIds = Array.from({ length: extraMembers + 1 }, () => uid("usr_limit_overrides"));
  const [ownerId] = userIds;
  const ownerEmail = `${uid("owner")}@example.com`;

  await db.insert(userTable).values(userIds.map((id, index) => ({
    id,
    email: index === 0 ? ownerEmail : `${uid("member")}@example.com`,
    emailVerified: new Date(),
  })));
  await db.insert(teamTable).values({
    id: teamId,
    name: "Acme",
    slug: teamId,
    subscriptionPlanId: planId,
    subscriptionStatus: isActive ? "active" : null,
  });
  await db.insert(teamMembershipTable).values(userIds.map((userId, index) => ({
    id: uid("tmem"),
    teamId,
    userId,
    roleId: index === 0 ? SYSTEM_ROLES_ENUM.OWNER : SYSTEM_ROLES_ENUM.MEMBER,
    isSystemRole: 1,
    invitedBy: ownerId,
    joinedAt: new Date(),
    isActive: 1,
  })));

  authState.current = {
    id: `sess_${ownerId}`,
    userId: ownerId,
    user: { id: ownerId, email: ownerEmail, firstName: "Test", lastName: "User", emailVerified: new Date() },
  };

  return teamId;
}

function setOverrides({
  teamId,
  overrides,
  hideFromCustomer = false,
}: {
  teamId: string;
  overrides: Parameters<typeof setTeamLimitOverridesAsStaff>[0]["overrides"];
  hideFromCustomer?: boolean;
}) {
  return setTeamLimitOverridesAsStaff({ teamId, overrides, hideFromCustomer, reason: REASON, staffUserId: STAFF_USER_ID });
}

function invite(teamId: string) {
  return inviteUserToTeam({
    teamId,
    email: normalizeEmail(`${uid("invitee")}@example.com`),
    roleId: SYSTEM_ROLES_ENUM.MEMBER,
    isSystemRole: true,
  });
}

// The seat counter of the members page: the same entitlements as the gate, from its own read.
async function seatUsage(teamId: string) {
  return (await getTeamMemberManagementData(teamId)).seatUsage;
}

async function memberCount(teamId: string): Promise<number> {
  return (await db.query.teamMembershipTable.findMany({ where: { teamId }, columns: { id: true } })).length;
}

async function refusal(action: Promise<unknown>): Promise<ActionError> {
  const error = await action.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(ActionError);
  return error as ActionError;
}

async function storedValue(teamId: string): Promise<string | null> {
  const team = await db.query.teamTable.findFirst({ where: { id: teamId }, columns: { limitOverrides: true } });
  return team?.limitOverrides ?? null;
}

describe("the seat limit", () => {
  test.skipIf(!CAN_RAISE_FREE_SEATS)("refuses at the plan value, and passes after a higher override", async () => {
    const teamId = await seedTeam({ extraMembers: FREE_LIMITS.seats - 1 });
    const raised = FREE_LIMITS.seats + 1;

    const atPlanLimit = await refusal(invite(teamId));
    expect(atPlanLimit.code).toBe("PRECONDITION_FAILED");
    expect(atPlanLimit.messageParams?.seats).toBe(FREE_LIMITS.seats);

    const view = await setOverrides({ teamId, overrides: { seats: raised } });
    expect(view.planLimits.seats).toBe(FREE_LIMITS.seats);
    expect(view.overrides).toEqual({ seats: raised });
    expect(view.limits.seats).toBe(raised);
    expect(await seatUsage(teamId)).toMatchObject({ limit: raised, isFull: false });

    await expect(invite(teamId)).resolves.toEqual({ success: true });
    const atOverride = await refusal(invite(teamId));
    expect(atOverride.messageParams?.seats).toBe(raised);
  });

  test.skipIf(!MULTI_SEAT_PLAN_ID)("a lower override refuses earlier and removes no member", async () => {
    const lowered = TEAM_LIMIT_OVERRIDE_BOUNDS.seats.min;
    const teamId = await seedTeam({ planId: MULTI_SEAT_PLAN_ID, isActive: true, extraMembers: lowered });

    await setOverrides({ teamId, overrides: { seats: lowered } });

    // Like a downgrade: every member stays, and no one can be invited.
    expect(await memberCount(teamId)).toBe(lowered + 1);
    expect(await seatUsage(teamId)).toMatchObject({ used: lowered + 1, limit: lowered, isFull: true });
    const refused = await refusal(invite(teamId));
    expect(refused.messageParams?.seats).toBe(lowered);

    // Without the override the plan value applies again.
    await setOverrides({ teamId, overrides: {} });
    expect((await seatUsage(teamId))?.limit).toBe(TEAM_PLANS[MULTI_SEAT_PLAN_ID ?? DEFAULT_PLAN_ID].limits.seats);
    await expect(invite(teamId)).resolves.toEqual({ success: true });
  });
});

describe("the stored value", () => {
  test("a value outside the bounds is refused, and nothing is stored", async () => {
    const teamId = await seedTeam();

    await expect(setOverrides({ teamId, overrides: { seats: TEAM_LIMIT_OVERRIDE_BOUNDS.seats.max + 1 } })).rejects.toThrow();

    expect(await storedValue(teamId)).toBeNull();
  });

  test("an unknown team is refused", async () => {
    const missing = await refusal(setOverrides({ teamId: uid("team_missing"), overrides: {} }));
    expect(missing.code).toBe("NOT_FOUND");
  });

  test.skipIf(!CAN_RAISE_FREE_SEATS)("the hide flag is stored with the limits, changes no limit, and goes with the last limit", async () => {
    const teamId = await seedTeam();
    const seats = FREE_LIMITS.seats + 1;

    const hidden = await setOverrides({ teamId, overrides: { seats }, hideFromCustomer: true });
    expect(hidden).toMatchObject({ hideFromCustomer: true, overrides: { seats }, appliedOverrides: { seats } });
    expect(hidden.limits.seats).toBe(seats);
    expect(await storedValue(teamId)).toBe(JSON.stringify({ hideFromCustomer: true, limits: { seats } }));
    expect((await seatUsage(teamId))?.limit).toBe(seats);

    const removed = await setOverrides({ teamId, overrides: {}, hideFromCustomer: true });
    expect(removed.hideFromCustomer).toBe(false);
    expect(await storedValue(teamId)).toBeNull();
  });

  test.skipIf(!MULTI_SEAT_PLAN_ID)("a paid plan with no paid access suspends a raise, and the view says which keys apply", async () => {
    const teamId = await seedTeam({ planId: MULTI_SEAT_PLAN_ID, isActive: true });
    const raised = TEAM_LIMIT_OVERRIDE_BOUNDS.seats.max;
    const projects = TEAM_LIMIT_OVERRIDE_BOUNDS.projects.min;
    await setOverrides({ teamId, overrides: { seats: raised, projects } });
    expect((await seatUsage(teamId))?.limit).toBe(raised);

    await db.update(teamTable).set({ subscriptionStatus: "past_due" }).where(eq(teamTable.id, teamId));

    expect((await seatUsage(teamId))?.limit).toBe(FREE_LIMITS.seats);
    const view = await loadTeamLimitOverrides({ teamId });
    expect(view.isActive).toBe(false);
    expect(view.overrides).toEqual({ seats: raised, projects });
    // Only the restriction below the Free value applies; none where Free has no room below it.
    const applied = projects < FREE_LIMITS.projects ? { projects } : {};
    expect(view.appliedOverrides).toEqual(applied);
    expect(view.limits).toEqual({ ...FREE_LIMITS, ...applied });

    await db.update(teamTable).set({ subscriptionStatus: "active" }).where(eq(teamTable.id, teamId));
    expect((await seatUsage(teamId))?.limit).toBe(raised);
  });

  test("a bad stored value does not break a read: the team gets the plan limits", async () => {
    const teamId = await seedTeam();
    await db.update(teamTable).set({ limitOverrides: "{not json" }).where(eq(teamTable.id, teamId));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect((await seatUsage(teamId))?.limit).toBe(FREE_LIMITS.seats);
    const view = await loadTeamLimitOverrides({ teamId });
    expect(view.overrides).toEqual({});
    expect(view.limits).toEqual(FREE_LIMITS);
    log.mockRestore();
  });
});
