import "server-only";

import type { getDB } from "@/db";
import { SYSTEM_ROLES_ENUM } from "@/db/schema";

// Centralized raw-SQL write layer for race-safe conditional inserts and same-batch state changes.
// These paths use native D1 prepared statements so SQL, bind ordering, and D1 result metadata stay
// explicit in one place. The drizzle schema shape (including commonColumns) is otherwise re-encoded
// by hand at each call site, where a positional mismatch or forgotten column is a silent runtime
// failure rather than a type error.

type D1Client = ReturnType<typeof getDB>["$client"];
type D1PreparedStatement = ReturnType<D1Client["prepare"]>;
type Bind = string | number | null;

// A capacity guard is the `WHERE <predicate>` tail of a conditional INSERT ... SELECT, plus the
// binds that predicate consumes (appended after the row values). Because the guard is evaluated
// inside the same statement as the insert, no concurrent request can pass a stale read-then-write
// count. Use UNCONDITIONAL for an insert with no capacity constraint.
interface CapacityGuard {
  predicate: string;
  binds: Bind[];
}

const UNCONDITIONAL: CapacityGuard = { predicate: "1", binds: [] };

// Capacity policy (explicit product decision): only a currently-active, unexpired membership
// consumes a seat or a joined/owned-team slot. This mirrors the auth predicate
// isMembershipCurrentlyActive (src/utils/team-membership.ts) and the invitation seat rule below
// (expired invitations don't count) — a membership that grants no access must not hold capacity,
// so a deactivated/expired row frees its slot rather than permanently reserving it. Every
// membership COUNT here filters by this fragment; its single trailing `?` binds now (unix seconds).
const ACTIVE_MEMBERSHIP_PREDICATE = `"isActive" = 1 AND ("expiresAt" IS NULL OR "expiresAt" > ?)`;

// D1 stores `integer({ mode: "timestamp" })` columns as Unix seconds. Raw SQL bypasses drizzle's
// encoder, so convert Dates explicitly when binding them.
export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

// Detect a SQLite UNIQUE-constraint violation surfaced by D1 so callers can translate a
// duplicate-membership / duplicate-invitation / slug race into a friendly error instead of a 500.
// The unique indexes are the authoritative guard; this only maps the resulting error. Drizzle
// wraps the D1 error in a "Failed query" Error with the real message on `cause`, so walk the cause
// chain. Match only UNIQUE variants — a bare SQLITE_CONSTRAINT would also match foreign-key failures.
export function isUniqueConstraintError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const message = current instanceof Error ? current.message : String(current);
    if (/UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(message)) {
      return true;
    }
    current = current instanceof Error ? current.cause : null;
  }
  return false;
}

// Guard: the user currently holds fewer than `max` active memberships (the joined-team cap).
export function withinJoinedTeamCap({
  userId,
  max,
  nowSec,
}: {
  userId: string;
  max: number;
  nowSec: number;
}): CapacityGuard {
  return {
    predicate: `(SELECT COUNT(*) FROM team_membership WHERE "userId" = ? AND ${ACTIVE_MEMBERSHIP_PREDICATE}) < ?`,
    binds: [userId, nowSec, max],
  };
}

// Guard: the team's seat usage (active members + non-expired, unaccepted invitations) is below
// `seats`.
export function withinSeatCap({
  teamId,
  seats,
  nowSec,
}: {
  teamId: string;
  seats: number;
  nowSec: number;
}): CapacityGuard {
  return {
    predicate:
      `((SELECT COUNT(*) FROM team_membership WHERE "teamId" = ? AND ${ACTIVE_MEMBERSHIP_PREDICATE})` +
      ` + (SELECT COUNT(*) FROM team_invitation` +
      ` WHERE "teamId" = ? AND "acceptedAt" IS NULL AND "expiresAt" > ?)) < ?`,
    binds: [teamId, nowSec, teamId, nowSec, seats],
  };
}

// Guard combinator: both guards must hold. Used by team creation, which enforces the owner cap
// and the joined-team cap in the same insert.
export function bothGuards(a: CapacityGuard, b: CapacityGuard): CapacityGuard {
  return {
    predicate: `(${a.predicate}) AND (${b.predicate})`,
    binds: [...a.binds, ...b.binds],
  };
}

// Guard: the owner cap — the user owns fewer than `max` teams (active system owner memberships).
export function withinOwnedTeamCap({
  userId,
  max,
  nowSec,
}: {
  userId: string;
  max: number;
  nowSec: number;
}): CapacityGuard {
  return {
    predicate: `(SELECT COUNT(*) FROM team_membership WHERE "userId" = ? AND "roleId" = ? AND "isSystemRole" = 1 AND ${ACTIVE_MEMBERSHIP_PREDICATE}) < ?`,
    binds: [userId, SYSTEM_ROLES_ENUM.OWNER, nowSec, max],
  };
}

// Guard: the referenced team row exists. Binds the owner membership to the team insert inside one
// batch so a partial failure can never leave an ownerless orphan team.
export function whenTeamExists(teamId: string): CapacityGuard {
  return { predicate: `EXISTS (SELECT 1 FROM team WHERE "id" = ?)`, binds: [teamId] };
}

interface TeamInsert {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatarUrl: string | null;
  nowSec: number;
}

// Single source of truth for the `team` insert column list + bind order.
export function buildTeamInsert(
  d1: D1Client,
  row: TeamInsert,
  guard: CapacityGuard = UNCONDITIONAL,
): D1PreparedStatement {
  return d1
    .prepare(
      `INSERT INTO team
         ("id", "createdAt", "updatedAt", "updateCounter", "name", "slug", "description", "avatarUrl", "subscriptionPlanId", "cancelAtPeriodEnd")
       SELECT ?, ?, ?, 0, ?, ?, ?, ?, 'free', 0
       WHERE ${guard.predicate}`,
    )
    .bind(row.id, row.nowSec, row.nowSec, row.name, row.slug, row.description, row.avatarUrl, ...guard.binds);
}

interface MembershipInsert {
  id: string;
  teamId: string;
  userId: string;
  roleId: string;
  isSystemRole: boolean;
  invitedBy: string;
  invitedAtSec: number;
  joinedAtSec: number;
  nowSec: number;
}

// Single source of truth for the `team_membership` insert column list + bind order. Every
// race-safe membership insert (team creation, invitation acceptance) goes through here so
// commonColumns (createdAt/updatedAt/updateCounter) can never be silently dropped.
export function buildMembershipInsert(
  d1: D1Client,
  row: MembershipInsert,
  guard: CapacityGuard = UNCONDITIONAL,
): D1PreparedStatement {
  return d1
    .prepare(
      `INSERT INTO team_membership
         ("id", "createdAt", "updatedAt", "updateCounter", "teamId", "userId", "roleId", "isSystemRole", "invitedBy", "invitedAt", "joinedAt", "isActive")
       SELECT ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 1
       WHERE ${guard.predicate}`,
    )
    .bind(
      row.id,
      row.nowSec,
      row.nowSec,
      row.teamId,
      row.userId,
      row.roleId,
      row.isSystemRole ? 1 : 0,
      row.invitedBy,
      row.invitedAtSec,
      row.joinedAtSec,
      ...guard.binds,
    );
}

interface MembershipReactivation {
  teamId: string;
  userId: string;
  roleId: string;
  isSystemRole: boolean;
  invitationId: string;
  nowSec: number;
}

// Reactivate an inactive/expired membership only while its invitation is still pending and the
// user has joined-team capacity. This statement is paired with invitation acceptance in one D1
// batch, so concurrent acceptances cannot reactivate two memberships from the same free slot.
export function buildMembershipReactivation(
  d1: D1Client,
  row: MembershipReactivation,
  guard: CapacityGuard,
): D1PreparedStatement {
  return d1
    .prepare(
      `UPDATE team_membership
         SET "roleId" = ?, "isSystemRole" = ?, "isActive" = 1, "expiresAt" = NULL,
             "updatedAt" = ?, "updateCounter" = "updateCounter" + 1
       WHERE "teamId" = ? AND "userId" = ?
         AND ("isActive" != 1 OR ("expiresAt" IS NOT NULL AND "expiresAt" <= ?))
         AND EXISTS (
           SELECT 1 FROM team_invitation
           WHERE "id" = ? AND "teamId" = ? AND "acceptedAt" IS NULL
             AND ("expiresAt" IS NULL OR "expiresAt" > ?)
         )
         AND ${guard.predicate}`,
    )
    .bind(
      row.roleId,
      row.isSystemRole ? 1 : 0,
      row.nowSec,
      row.teamId,
      row.userId,
      row.nowSec,
      row.invitationId,
      row.teamId,
      row.nowSec,
      ...guard.binds,
    );
}

interface InvitationAcceptance {
  invitationId: string;
  teamId: string;
  userId: string;
  nowSec: number;
}

// Accept an invitation only after the same batch has made its membership currently active. This
// keeps insert and reactivation paths from consuming an invitation without granting membership.
export function buildInvitationAcceptance(
  d1: D1Client,
  row: InvitationAcceptance,
): D1PreparedStatement {
  return d1.prepare(
    `UPDATE team_invitation
       SET "acceptedAt" = ?, "acceptedBy" = ?, "updatedAt" = ?, "updateCounter" = "updateCounter" + 1
     WHERE "id" = ? AND "acceptedAt" IS NULL
       AND EXISTS (
         SELECT 1 FROM team_membership
         WHERE "teamId" = ? AND "userId" = ? AND "isActive" = 1
           AND ("expiresAt" IS NULL OR "expiresAt" > ?)
       )`,
  ).bind(
    row.nowSec,
    row.userId,
    row.nowSec,
    row.invitationId,
    row.teamId,
    row.userId,
    row.nowSec,
  );
}

interface InvitationInsert {
  id: string;
  teamId: string;
  email: string;
  roleId: string;
  isSystemRole: boolean;
  tokenHash: string;
  invitedBy: string;
  expiresAtSec: number;
  nowSec: number;
}

// Single source of truth for the `team_invitation` insert column list + bind order.
export function buildInvitationInsert(
  d1: D1Client,
  row: InvitationInsert,
  guard: CapacityGuard = UNCONDITIONAL,
): D1PreparedStatement {
  return d1
    .prepare(
      `INSERT INTO team_invitation
         ("id", "createdAt", "updatedAt", "updateCounter", "teamId", "email", "roleId", "isSystemRole", "token", "invitedBy", "expiresAt", "acceptedAt", "acceptedBy")
       SELECT ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, NULL, NULL
       WHERE ${guard.predicate}`,
    )
    .bind(
      row.id,
      row.nowSec,
      row.nowSec,
      row.teamId,
      row.email,
      row.roleId,
      row.isSystemRole ? 1 : 0,
      row.tokenHash,
      row.invitedBy,
      row.expiresAtSec,
      ...guard.binds,
    );
}

// Whether a native D1 statement/batch result inserted a row. A conditional INSERT ... SELECT that
// fails its capacity guard commits successfully with zero changes, so callers distinguish
// "blocked by capacity" from "written" via this rather than via an exception.
export function didInsert(result: { meta?: { changes?: number } } | undefined): boolean {
  return (result?.meta?.changes ?? 0) === 1;
}
