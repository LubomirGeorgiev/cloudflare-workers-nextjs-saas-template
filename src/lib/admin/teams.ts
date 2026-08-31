import "server-only";

import { and, count, desc, eq, exists, gt, gte, inArray, isNull, like, lte, or, sql } from "drizzle-orm";

import { DEFAULT_PLAN_ID, type TeamPlanId } from "@/constants/plans";
import { getDB } from "@/db";
import {
  apiKeyTable,
  teamInvitationTable,
  teamMembershipTable,
  teamTable,
  userTable,
} from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { createCustomRoleNameResolver } from "@/lib/teams/team-roles";
import { isMembershipCurrentlyActive } from "@/utils/team-membership";

// Shared team administration, the counterpart of `./users.ts`: the admin panel actions and any
// future internal REST/MCP surface run one code path instead of each querying D1 their own way.
//
// Deliberately *not* self-authenticating, for the same reason `listAdminUsers` is not: the panel
// authorizes with a cookie session (`requireAdmin`) and the internal API with a bearer credential
// (`assertAdminPrincipal`). Authorization stays at the door; this module is a pure data layer.
// Never mount one of these on a route without a guard ahead of it.

/**
 * How many members the listing carries per team. The column shows faces, not a roster: the rest
 * are a "+N" that opens the team page. It also bounds the preview query, which would otherwise
 * return every membership row of every team on the page.
 */
const TEAM_MEMBER_PREVIEW_LIMIT = 4;

/**
 * The team page lists members in full rather than paginating them, so the read is capped and the
 * page says so when it truncates. A team that hits this is far past any plan's seat count.
 */
const TEAM_MEMBERS_MAX = 500;

/** Pending invitations shown on the team page; a team past this is mid-onboarding, not browsing. */
const TEAM_INVITATIONS_MAX = 100;

/** Team-scoped API keys shown on the team page; live keys only, same as the owner-facing list. */
const TEAM_API_KEYS_MAX = 100;

// D1 caps bound parameters at SQLite's 100 per statement, and a team id costs one. A listing page
// reaches MAX_ADMIN_TABLE_PAGE_SIZE ids, and the preview query binds its rank cap on top of them,
// so the id lists chunk instead of letting that cap become an invisible ceiling on the page size.
const TEAM_ID_CHUNK_SIZE = 50;

/**
 * A capped section list and the flag that says the cap cut it. Every team-page section reads the
 * same way — one row over the cap, then truncate — so no section can silently hide a row.
 */
export interface AdminTeamSectionList<TItem> {
  items: TItem[];
  hasMore: boolean;
}

function toSectionList<TItem>(rows: TItem[], max: number): AdminTeamSectionList<TItem> {
  return { items: rows.slice(0, max), hasMore: rows.length > max };
}

function chunkTeamIds(teamIds: string[]): string[][] {
  const chunks: string[][] = [];

  for (let start = 0; start < teamIds.length; start += TEAM_ID_CHUNK_SIZE) {
    chunks.push(teamIds.slice(start, start + TEAM_ID_CHUNK_SIZE));
  }

  return chunks;
}

interface AdminTeamMemberPreview {
  userId: string;
  email: string | null;
  name: string | null;
}

interface AdminTeamSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  planId: TeamPlanId;
  subscriptionStatus: string | null;
  createdAt: Date;
  memberCount: number;
  /** At most `TEAM_MEMBER_PREVIEW_LIMIT` members; `memberCount` is the real total. */
  members: AdminTeamMemberPreview[];
}

interface AdminTeamPage {
  teams: AdminTeamSummary[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AdminTeamMember {
  membershipId: string;
  userId: string;
  email: string | null;
  name: string | null;
  roleId: string;
  /** Set only for a custom role; system roles are labelled from `roleId` at the render site. */
  roleName: string | null;
  isSystemRole: boolean;
  isActive: boolean;
  joinedAt: Date | null;
  expiresAt: Date | null;
}

export interface AdminTeamInvitation {
  id: string;
  email: string;
  roleId: string;
  /** Set only for a custom role, exactly as on a membership: the role row exists before acceptance. */
  roleName: string | null;
  isSystemRole: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export interface AdminTeamApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  last4: string;
  scopes: string[];
  ownerId: string;
  ownerEmail: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

/**
 * What the team page paints before anything streams in: the row itself plus its billing columns.
 * Deliberately not the listing row — the detail page renders no member preview, so carrying one
 * would read every team page's memberships for nothing.
 */
interface AdminTeamHeader {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  planId: TeamPlanId;
  subscriptionStatus: string | null;
  createdAt: Date;
  memberCount: number;
  billingEmail: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

function toDisplayName({
  firstName,
  lastName,
}: {
  firstName: string | null;
  lastName: string | null;
}): string | null {
  return firstName && lastName ? `${firstName} ${lastName}` : (firstName || lastName || null);
}

/**
 * One search box over three things staff actually search by: the team's name, its slug, and the
 * email of somebody in it ("which team is this customer on?"). The member clause is an EXISTS
 * subquery rather than a join, so a team with several matching members stays one row and the count
 * query can reuse the same predicate.
 */
function buildTeamSearchFilter(search: string | undefined) {
  const pattern = search ? `%${search}%` : null;

  if (!pattern) {
    return undefined;
  }

  const memberMatches = getDB()
    .select({ matched: sql`1` })
    .from(teamMembershipTable)
    .innerJoin(userTable, eq(userTable.id, teamMembershipTable.userId))
    .where(and(eq(teamMembershipTable.teamId, teamTable.id), like(userTable.email, pattern)));

  return or(
    like(teamTable.name, pattern),
    like(teamTable.slug, pattern),
    exists(memberMatches),
  );
}

// One query for the whole page's previews, not one per team: `row_number()` numbers each team's
// members independently, and the outer filter keeps the first few of each. Without the window the
// only bounded alternatives are a query per row or an unbounded fetch of every membership.
async function listMemberPreviews(teamIds: string[]): Promise<Map<string, AdminTeamMemberPreview[]>> {
  const previews = new Map<string, AdminTeamMemberPreview[]>();
  const db = getDB();

  for (const chunk of chunkTeamIds(teamIds)) {
    const ranked = db
      .select({
        teamId: teamMembershipTable.teamId,
        userId: userTable.id,
        email: userTable.email,
        firstName: userTable.firstName,
        lastName: userTable.lastName,
        rank: sql<number>`row_number() over (
          partition by ${teamMembershipTable.teamId}
          order by ${teamMembershipTable.joinedAt} asc, ${userTable.id} asc
        )`.as("rank"),
      })
      .from(teamMembershipTable)
      .innerJoin(userTable, eq(userTable.id, teamMembershipTable.userId))
      .where(inArray(teamMembershipTable.teamId, chunk))
      .as("ranked");

    const rows = await db
      .select({
        teamId: ranked.teamId,
        userId: ranked.userId,
        email: ranked.email,
        firstName: ranked.firstName,
        lastName: ranked.lastName,
      })
      .from(ranked)
      .where(lte(ranked.rank, TEAM_MEMBER_PREVIEW_LIMIT));

    for (const row of rows) {
      const members = previews.get(row.teamId) ?? [];
      members.push({ userId: row.userId, email: row.email, name: toDisplayName(row) });
      previews.set(row.teamId, members);
    }
  }

  return previews;
}

async function countMembers(teamIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const db = getDB();

  for (const chunk of chunkTeamIds(teamIds)) {
    const rows = await db
      .select({ teamId: teamMembershipTable.teamId, memberCount: count() })
      .from(teamMembershipTable)
      .where(inArray(teamMembershipTable.teamId, chunk))
      .groupBy(teamMembershipTable.teamId);

    for (const row of rows) {
      counts.set(row.teamId, row.memberCount);
    }
  }

  return counts;
}

export async function listAdminTeams({
  page,
  pageSize,
  search,
}: {
  page: number;
  pageSize: number;
  search?: string;
}): Promise<AdminTeamPage> {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  // The count and the page must filter identically, so the predicate is built once.
  const filter = buildTeamSearchFilter(search);

  const [[{ totalCount }], teams] = await Promise.all([
    db.select({ totalCount: count() }).from(teamTable).where(filter),
    db
      .select({
        id: teamTable.id,
        name: teamTable.name,
        slug: teamTable.slug,
        description: teamTable.description,
        subscriptionPlanId: teamTable.subscriptionPlanId,
        subscriptionStatus: teamTable.subscriptionStatus,
        createdAt: teamTable.createdAt,
      })
      .from(teamTable)
      .where(filter)
      .orderBy(desc(teamTable.createdAt))
      .limit(pageSize)
      .offset(offset),
  ]);

  const teamIds = teams.map((team) => team.id);
  const [memberCounts, memberPreviews] = await Promise.all([
    countMembers(teamIds),
    listMemberPreviews(teamIds),
  ]);

  return {
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      slug: team.slug,
      description: team.description,
      planId: team.subscriptionPlanId ?? DEFAULT_PLAN_ID,
      subscriptionStatus: team.subscriptionStatus,
      createdAt: team.createdAt,
      memberCount: memberCounts.get(team.id) ?? 0,
      members: memberPreviews.get(team.id) ?? [],
    })),
    totalCount,
    page,
    pageSize,
    totalPages: Math.ceil(totalCount / pageSize),
  };
}

async function countTeamMembers(teamId: string): Promise<number> {
  const [row] = await getDB()
    .select({ memberCount: count() })
    .from(teamMembershipTable)
    .where(eq(teamMembershipTable.teamId, teamId));

  return row?.memberCount ?? 0;
}

export async function listTeamMembers(
  teamId: string,
): Promise<AdminTeamSectionList<AdminTeamMember>> {
  const db = getDB();

  const memberships = await db
    .select({
      membershipId: teamMembershipTable.id,
      userId: userTable.id,
      email: userTable.email,
      firstName: userTable.firstName,
      lastName: userTable.lastName,
      roleId: teamMembershipTable.roleId,
      isSystemRole: teamMembershipTable.isSystemRole,
      isActive: teamMembershipTable.isActive,
      joinedAt: teamMembershipTable.joinedAt,
      expiresAt: teamMembershipTable.expiresAt,
    })
    .from(teamMembershipTable)
    .innerJoin(userTable, eq(userTable.id, teamMembershipTable.userId))
    .where(eq(teamMembershipTable.teamId, teamId))
    .orderBy(teamMembershipTable.joinedAt)
    // One over the cap, so the caller can tell a full page from a truncated one.
    .limit(TEAM_MEMBERS_MAX + 1);

  const rows = memberships.map((member) => ({
    ...member,
    teamId,
    isSystemRole: Boolean(member.isSystemRole),
  }));
  const resolveRoleName = await createCustomRoleNameResolver(rows);

  const members = rows.map((member) => ({
    membershipId: member.membershipId,
    userId: member.userId,
    email: member.email,
    name: toDisplayName(member),
    roleId: member.roleId,
    roleName: resolveRoleName(member),
    isSystemRole: member.isSystemRole,
    // The stored flag is only half the rule: an expired membership grants nothing, so staff must
    // not read it as active either. `isMembershipCurrentlyActive` is that rule everywhere.
    isActive: isMembershipCurrentlyActive({
      isActive: member.isActive,
      expiresAt: member.expiresAt,
    }),
    joinedAt: member.joinedAt,
    expiresAt: member.expiresAt,
  }));

  return toSectionList(members, TEAM_MEMBERS_MAX);
}

// Pending only: an accepted invitation is a membership, and an expired one is nothing anybody can
// act on. Same rule the team dashboard's invitation list applies.
export async function listTeamInvitations(
  teamId: string,
): Promise<AdminTeamSectionList<AdminTeamInvitation>> {
  const invitations = await getDB()
    .select({
      id: teamInvitationTable.id,
      email: teamInvitationTable.email,
      roleId: teamInvitationTable.roleId,
      isSystemRole: teamInvitationTable.isSystemRole,
      createdAt: teamInvitationTable.createdAt,
      expiresAt: teamInvitationTable.expiresAt,
    })
    .from(teamInvitationTable)
    .where(and(
      eq(teamInvitationTable.teamId, teamId),
      isNull(teamInvitationTable.acceptedAt),
      gte(teamInvitationTable.expiresAt, new Date()),
    ))
    .orderBy(teamInvitationTable.expiresAt)
    // One over the cap, so the caller can tell a full page from a truncated one.
    .limit(TEAM_INVITATIONS_MAX + 1);

  // An invitation carries the same role pair a membership does, so it resolves the same way: the
  // custom role row already exists, and only acceptance is missing.
  const rows = invitations.map((row) => ({
    ...row,
    teamId,
    isSystemRole: Boolean(row.isSystemRole),
  }));
  const resolveRoleName = await createCustomRoleNameResolver(rows);

  return toSectionList(
    rows.map((row) => ({
      id: row.id,
      email: row.email,
      roleId: row.roleId,
      roleName: resolveRoleName(row),
      isSystemRole: row.isSystemRole,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    })),
    TEAM_INVITATIONS_MAX,
  );
}

// Revoked and expired keys stay in D1 as history but never surface, matching the owner-facing list
// and the admin user page: neither is something anyone can act on. Expired rows are never swept, so
// without the expiry predicate they would fill the cap and push the live keys out of the listing.
export async function listTeamApiKeys(
  teamId: string,
): Promise<AdminTeamSectionList<AdminTeamApiKey>> {
  const rows = await getDB()
    .select({
      id: apiKeyTable.id,
      name: apiKeyTable.name,
      keyPrefix: apiKeyTable.keyPrefix,
      last4: apiKeyTable.last4,
      scopes: apiKeyTable.scopes,
      ownerId: userTable.id,
      ownerEmail: userTable.email,
      createdAt: apiKeyTable.createdAt,
      lastUsedAt: apiKeyTable.lastUsedAt,
      expiresAt: apiKeyTable.expiresAt,
    })
    .from(apiKeyTable)
    .innerJoin(userTable, eq(userTable.id, apiKeyTable.userId))
    .where(and(
      eq(apiKeyTable.teamId, teamId),
      isNull(apiKeyTable.revokedAt),
      or(isNull(apiKeyTable.expiresAt), gt(apiKeyTable.expiresAt, new Date())),
    ))
    .orderBy(apiKeyTable.createdAt)
    // One over the cap, so the caller can tell a full page from a truncated one.
    .limit(TEAM_API_KEYS_MAX + 1);

  return toSectionList(rows, TEAM_API_KEYS_MAX);
}

// The cheap half of the team page, kept separate from the three section reads so the page can
// paint its header and stream the rest: `generateMetadata` needs only this.
export async function getAdminTeamHeader({ teamId }: { teamId: string }): Promise<AdminTeamHeader> {
  const team = await getDB().query.teamTable.findFirst({
    where: { id: teamId },
    columns: {
      id: true,
      name: true,
      slug: true,
      description: true,
      subscriptionPlanId: true,
      subscriptionStatus: true,
      createdAt: true,
      billingEmail: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
    },
  });

  if (!team) {
    throw new ActionError("NOT_FOUND", "Team not found");
  }

  return {
    id: team.id,
    name: team.name,
    slug: team.slug,
    description: team.description,
    planId: team.subscriptionPlanId ?? DEFAULT_PLAN_ID,
    subscriptionStatus: team.subscriptionStatus,
    createdAt: team.createdAt,
    memberCount: await countTeamMembers(teamId),
    billingEmail: team.billingEmail,
    stripeCustomerId: team.stripeCustomerId,
    stripeSubscriptionId: team.stripeSubscriptionId,
  };
}
