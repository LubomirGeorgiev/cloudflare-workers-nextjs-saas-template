/// <reference types="@cloudflare/vitest-plugin/types" />

// Behavior coverage for the admin teams listing against a real D1. Three things here cannot be
// checked by a unit test with a mocked database:
//
//   1. the member preview is a `row_number()` window query, so its per-team cap and its ordering
//      are SQLite behavior, not application logic;
//   2. the search box matches a team by the email of somebody in it, through an EXISTS subquery
//      that the count and the page must both apply, or the pager disagrees with the rows; and
//   3. a page of team ids binds one parameter per id, and only a real statement enforces SQLite's
//      100-parameter ceiling that the id chunking exists for.
//
// The service is deliberately not self-authenticating (the panel and the internal API authorize at
// their own doors), so it is called directly here with no session to mock.

import { expect, test } from "vitest";

import { ADMIN_TABLE_PAGE_SIZE_OPTIONS, MAX_ADMIN_TABLE_PAGE_SIZE } from "@/constants";
import { getDB } from "@/db";
import {
  SYSTEM_ROLES_ENUM,
  apiKeyTable,
  teamInvitationTable,
  teamMembershipTable,
  teamRoleTable,
  teamTable,
  userTable,
} from "@/db/schema";
import {
  getAdminTeamHeader,
  listAdminTeams,
  listTeamApiKeys,
  listTeamInvitations,
  listTeamMembers,
} from "@/lib/admin/teams";

const db = getDB();

// The ceiling the id chunking exists for: SQLite binds at most 100 parameters per statement, and a
// team id costs one. The smallest page size that reaches it is the smallest page that used to fail.
const D1_BOUND_PARAMETER_LIMIT = 100;
const PAGE_SIZE_AT_PARAMETER_CAP = ADMIN_TABLE_PAGE_SIZE_OPTIONS
  .find((size) => size >= D1_BOUND_PARAMETER_LIMIT) ?? MAX_ADMIN_TABLE_PAGE_SIZE;

// Rows per insert statement. Every column of every row binds a parameter too, so the seeding must
// stay under the same ceiling as the code it tests.
const SEED_INSERT_BATCH_SIZE = 8;

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

async function seedTeam({ memberCount, name }: { memberCount: number; name?: string }) {
  const teamId = uid("team");
  const slug = uid("slug");
  const emails: string[] = [];
  const userIds: string[] = [];

  await db.insert(teamTable).values({ id: teamId, name: name ?? uid("Team"), slug });

  for (let index = 0; index < memberCount; index += 1) {
    const userId = uid("usr");
    const email = `${uid("member")}@example.com`;
    emails.push(email);
    userIds.push(userId);

    await db.insert(userTable).values({ id: userId, email, emailVerified: new Date() });
    await db.insert(teamMembershipTable).values({
      id: uid("tmem"),
      teamId,
      userId,
      roleId: index === 0 ? SYSTEM_ROLES_ENUM.OWNER : SYSTEM_ROLES_ENUM.MEMBER,
      isSystemRole: 1,
      // Spread the join dates so the preview's ordering is deterministic and observable.
      joinedAt: new Date(Date.UTC(2024, 0, 1 + index)),
      isActive: 1,
    });
  }

  return { teamId, slug, emails, userIds };
}

async function insertInBatches<TRow>(
  insert: (rows: TRow[]) => Promise<unknown>,
  rows: TRow[],
): Promise<void> {
  for (let start = 0; start < rows.length; start += SEED_INSERT_BATCH_SIZE) {
    await insert(rows.slice(start, start + SEED_INSERT_BATCH_SIZE));
  }
}

// One member each: what the parameter ceiling counts is the number of teams on the page, so this
// seeds teams cheaply rather than rosters.
async function seedTeams(teamCount: number): Promise<string[]> {
  const seeds = Array.from({ length: teamCount }, () => ({
    team: { id: uid("team"), name: uid("Team"), slug: uid("slug") },
    user: { id: uid("usr"), email: `${uid("member")}@example.com`, emailVerified: new Date() },
  }));

  await insertInBatches((rows) => db.insert(teamTable).values(rows), seeds.map((seed) => seed.team));
  await insertInBatches((rows) => db.insert(userTable).values(rows), seeds.map((seed) => seed.user));
  await insertInBatches(
    (rows) => db.insert(teamMembershipTable).values(rows),
    seeds.map((seed) => ({
      id: uid("tmem"),
      teamId: seed.team.id,
      userId: seed.user.id,
      roleId: SYSTEM_ROLES_ENUM.OWNER,
      isSystemRole: 1,
      joinedAt: new Date(),
      isActive: 1,
    })),
  );

  return seeds.map((seed) => seed.team.id);
}

function findTeam(page: Awaited<ReturnType<typeof listAdminTeams>>, teamId: string) {
  return page.teams.find((team) => team.id === teamId);
}

test("the member preview is capped per team while the count stays exact", async () => {
  const big = await seedTeam({ memberCount: 7 });

  const page = await listAdminTeams({ page: 1, pageSize: 100, search: big.slug });
  const team = findTeam(page, big.teamId);

  expect(team?.memberCount).toBe(7);
  expect(team?.members).toHaveLength(4);
  // Earliest joiners first, so the preview is the same set on every render.
  expect(team?.members.map((member) => member.email)).toEqual(big.emails.slice(0, 4));
});

test("each team on the page gets its own preview, not a share of one budget", async () => {
  const first = await seedTeam({ memberCount: 5 });
  const second = await seedTeam({ memberCount: 5 });

  // Both teams are returned by one call, so a global row limit would starve the later team.
  const page = await listAdminTeams({ page: 1, pageSize: 500 });

  expect(findTeam(page, first.teamId)?.members).toHaveLength(4);
  expect(findTeam(page, second.teamId)?.members).toHaveLength(4);
});

// One bound parameter per team id, plus the preview query's own rank bound on top of them: a page
// of 100 teams is 101 parameters, which SQLite refuses outright. The page only comes back when the
// id lists chunk, so this fails on the whole request rather than on a missing preview.
test("a full page of teams still resolves counts and previews past D1's parameter cap", async () => {
  await seedTeams(PAGE_SIZE_AT_PARAMETER_CAP);

  const page = await listAdminTeams({ page: 1, pageSize: PAGE_SIZE_AT_PARAMETER_CAP });

  expect(page.teams).toHaveLength(PAGE_SIZE_AT_PARAMETER_CAP);
  // Every returned team is covered by both batch reads, so no chunk was dropped on the way back.
  expect(page.teams.every((team) => team.memberCount > 0)).toBe(true);
  expect(page.teams.every((team) => team.members.length > 0)).toBe(true);

  const widest = await listAdminTeams({ page: 1, pageSize: MAX_ADMIN_TABLE_PAGE_SIZE });

  expect(widest.teams.length).toBeGreaterThanOrEqual(PAGE_SIZE_AT_PARAMETER_CAP);
  expect(widest.teams.every((team) => team.members.length > 0)).toBe(true);
});

test("search matches a team by a member's email, and the count matches the rows", async () => {
  const team = await seedTeam({ memberCount: 3 });
  const [memberEmail] = team.emails;

  const page = await listAdminTeams({ page: 1, pageSize: 50, search: memberEmail });

  expect(page.teams).toHaveLength(1);
  expect(page.teams[0]?.id).toBe(team.teamId);
  expect(page.totalCount).toBe(1);
});

test("search matches a team by name and returns no rows for an unknown term", async () => {
  const name = uid("Searchable Team");
  const team = await seedTeam({ memberCount: 1, name });

  const byName = await listAdminTeams({ page: 1, pageSize: 50, search: name });
  expect(byName.teams.map((row) => row.id)).toEqual([team.teamId]);

  const noMatch = await listAdminTeams({ page: 1, pageSize: 50, search: uid("nothing") });
  expect(noMatch.teams).toHaveLength(0);
  expect(noMatch.totalCount).toBe(0);
});

test("the team detail lists every member, not the preview", async () => {
  const team = await seedTeam({ memberCount: 6 });

  const [header, members, invitations, apiKeys] = await Promise.all([
    getAdminTeamHeader({ teamId: team.teamId }),
    listTeamMembers(team.teamId),
    listTeamInvitations(team.teamId),
    listTeamApiKeys(team.teamId),
  ]);

  expect(header.memberCount).toBe(6);
  // The header is the page's blocking read, so it must not carry the listing's member preview.
  expect(header).not.toHaveProperty("members");
  expect(members.items).toHaveLength(6);
  expect(members.hasMore).toBe(false);
  expect(members.items[0]?.roleId).toBe(SYSTEM_ROLES_ENUM.OWNER);
  expect(invitations).toEqual({ items: [], hasMore: false });
  expect(apiKeys).toEqual({ items: [], hasMore: false });
});

// The stored flag alone would show a green "Active" badge for access that has already lapsed.
test("a membership past its expiry is reported inactive, whatever its stored flag says", async () => {
  const team = await seedTeam({ memberCount: 1 });
  const userId = uid("usr");

  await db.insert(userTable).values({
    id: userId,
    email: `${uid("expired")}@example.com`,
    emailVerified: new Date(),
  });
  await db.insert(teamMembershipTable).values({
    id: uid("tmem"),
    teamId: team.teamId,
    userId,
    roleId: SYSTEM_ROLES_ENUM.MEMBER,
    isSystemRole: 1,
    joinedAt: new Date(Date.UTC(2024, 0, 1)),
    expiresAt: new Date(Date.now() - 60_000),
    isActive: 1,
  });

  const members = await listTeamMembers(team.teamId);
  const expired = members.items.find((member) => member.userId === userId);

  expect(expired?.isActive).toBe(false);
  // The unexpired owner is unaffected, so the rule is expiry and not a blanket false.
  expect(members.items.some((member) => member.isActive)).toBe(true);
});

// An expired key is as unusable as a revoked one, and expired rows are never swept: listing them
// would fill the section's cap with keys nobody can act on.
test("an expired API key is left out of the team's key list", async () => {
  const team = await seedTeam({ memberCount: 1 });
  const [ownerId] = team.userIds;
  const liveName = uid("Live key");

  await db.insert(apiKeyTable).values([
    {
      id: uid("akey"),
      userId: ownerId,
      teamId: team.teamId,
      name: liveName,
      keyHash: uid("hash"),
      keyPrefix: "sk_test",
      last4: "abcd",
      scopes: [],
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      id: uid("akey"),
      userId: ownerId,
      teamId: team.teamId,
      name: uid("Expired key"),
      keyHash: uid("hash"),
      keyPrefix: "sk_test",
      last4: "efgh",
      scopes: [],
      expiresAt: new Date(Date.now() - 60_000),
    },
  ]);

  const apiKeys = await listTeamApiKeys(team.teamId);

  expect(apiKeys.items.map((apiKey) => apiKey.name)).toEqual([liveName]);
  expect(apiKeys.hasMore).toBe(false);
});

// The custom role row exists from the moment the invitation is sent, so the name is available
// before acceptance; only a role belonging to another team resolves to no name.
test("a pending invitation to a custom role carries the role's name", async () => {
  const team = await seedTeam({ memberCount: 1 });
  const [inviterId] = team.userIds;
  const roleId = uid("trole");
  const roleName = uid("Support");

  await db.insert(teamRoleTable).values({
    id: roleId,
    teamId: team.teamId,
    name: roleName,
    permissions: [],
  });
  await db.insert(teamInvitationTable).values({
    id: uid("tinv"),
    teamId: team.teamId,
    email: `${uid("invitee")}@example.com`,
    roleId,
    isSystemRole: 0,
    token: uid("token"),
    invitedBy: inviterId,
    expiresAt: new Date(Date.now() + 60_000),
  });

  const invitations = await listTeamInvitations(team.teamId);

  expect(invitations.items).toHaveLength(1);
  expect(invitations.items[0]?.roleName).toBe(roleName);
});

test("an unknown team id is refused rather than rendered empty", async () => {
  await expect(getAdminTeamHeader({ teamId: uid("missing") })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
