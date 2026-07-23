import "server-only";
import { cache } from "react";
import { getDB } from "@/db";
import { SYSTEM_ROLES_ENUM, teamMembershipTable } from "@/db/schema";
import { requireVerifiedEmail } from "@/utils/auth";
import { generateSlug } from "@/utils/slugify";
import { ActionError } from "@/lib/action-error";
import { eq, and, count, gt, isNull, or } from "drizzle-orm";
import { updateAllSessionsOfUser } from "@/utils/kv-session";
import { isMembershipCurrentlyActive } from "@/utils/team-membership";
import { MAX_TEAMS_CREATED_PER_USER, MAX_TEAMS_JOINED_PER_USER } from "@/constants";
import {
  bothGuards,
  buildMembershipInsert,
  buildTeamInsert,
  didInsert,
  isUniqueConstraintError,
  toUnixSeconds,
  whenTeamExists,
  withinJoinedTeamCap,
  withinOwnedTeamCap,
} from "@/lib/teams/team-writes";
import { createHexId, createRandomId } from "@/utils/random-token";

// Deliberately narrow, client-safe projection of a team for the teams listing UI.
// Excludes billingEmail, Stripe customer/subscription IDs, raw settings JSON,
// subscription status/add-ons, and trial timestamps that live on the full team row.
export interface TeamSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatarUrl: string | null;
  role: {
    id: string;
    name: string;
  };
}

// Request-scoped cached lookup shared by team pages (generateMetadata + page render
// hit it in the same RSC pass).
export const getTeamBySlug = cache(async (teamSlug: string) => {
  const db = getDB();
  return db.query.teamTable.findFirst({ where: { slug: teamSlug } });
});

// Owned counts only active system-role owner memberships; joined counts every active membership.
// Used for the create-team caps (UX pre-check and post-insert diagnosis) — the atomic INSERT
// guard is the actual enforcement. The active-only filter matches the capacity policy documented
// in team-writes.ts (ACTIVE_MEMBERSHIP_PREDICATE): inactive/expired memberships don't hold a slot.
function isActiveMembership() {
  return and(
    eq(teamMembershipTable.isActive, 1),
    or(isNull(teamMembershipTable.expiresAt), gt(teamMembershipTable.expiresAt, new Date())),
  );
}

async function getUserTeamCounts(userId: string) {
  const db = getDB();

  const [ownedResult, joinedResult] = await Promise.all([
    db.select({ value: count() })
      .from(teamMembershipTable)
      .where(
        and(
          eq(teamMembershipTable.userId, userId),
          eq(teamMembershipTable.roleId, SYSTEM_ROLES_ENUM.OWNER),
          eq(teamMembershipTable.isSystemRole, 1),
          isActiveMembership(),
        )
      ),
    db.select({ value: count() })
      .from(teamMembershipTable)
      .where(and(eq(teamMembershipTable.userId, userId), isActiveMembership())),
  ]);

  return {
    teamsOwned: ownedResult[0]?.value ?? 0,
    teamsJoined: joinedResult[0]?.value ?? 0,
  };
}

export async function createTeam({
  name,
  description,
  avatarUrl
}: {
  name: string;
  description?: string;
  avatarUrl?: string;
}) {
  // requireVerifiedEmail throws when there is no verified session, so it always returns one here.
  const session = await requireVerifiedEmail();
  const userId = session.userId;
  const db = getDB();

  // Friendly pre-checks for UX only. The atomic guard in the INSERT below is the
  // actual enforcement, so a concurrent race cannot slip past these read-then-write counts.
  const { teamsOwned, teamsJoined } = await getUserTeamCounts(userId);

  if (teamsOwned >= MAX_TEAMS_CREATED_PER_USER) {
    throw new ActionError("FORBIDDEN", {
      key: "Client.Dashboard.Teams.errorCreateLimit",
      params: { max: MAX_TEAMS_CREATED_PER_USER },
    });
  }

  // Creating a team also joins it, so it counts against the joined-team cap.
  if (teamsJoined >= MAX_TEAMS_JOINED_PER_USER) {
    throw new ActionError("FORBIDDEN", {
      key: "Client.Dashboard.Teams.errorJoinLimit",
      params: { max: MAX_TEAMS_JOINED_PER_USER },
    });
  }

  // Ids are generated up front so the two inserts link inside one atomic batch. The
  // guarded INSERTs below are the authoritative enforcement of both caps, so the
  // pre-checks above are UX-only and a concurrent race cannot slip past them.
  const teamId = `team_${createRandomId()}`;
  const membershipId = `tmem_${createRandomId()}`;
  const nowSeconds = toUnixSeconds(new Date());
  const baseSlug = generateSlug(name);
  const d1 = db.$client;

  // Atomic, race-safe creation, retried on slug collision:
  //  - The team row inserts only while BOTH caps still hold (conditional INSERT ... SELECT).
  //  - The owner membership inserts in the same batch, guarded on the team row existing, so a
  //    partial failure can never leave an ownerless orphan team.
  //  - A concurrent create can steal the slug between attempts; regenerate a suffixed slug and
  //    retry rather than hard-failing the loser of the race.
  let teamCreated = false;
  let slug = baseSlug;

  for (let attempt = 0; attempt < 5 && !teamCreated; attempt++) {
    slug = attempt === 0 ? baseSlug : `${baseSlug}-${createHexId(3)}`;

    try {
      const results = await d1.batch([
        buildTeamInsert(
          d1,
          { id: teamId, name, slug, description: description ?? null, avatarUrl: avatarUrl ?? null, nowSec: nowSeconds },
          bothGuards(
            withinOwnedTeamCap({ userId, max: MAX_TEAMS_CREATED_PER_USER, nowSec: nowSeconds }),
            withinJoinedTeamCap({ userId, max: MAX_TEAMS_JOINED_PER_USER, nowSec: nowSeconds }),
          ),
        ),
        buildMembershipInsert(
          d1,
          {
            id: membershipId,
            teamId,
            userId,
            roleId: SYSTEM_ROLES_ENUM.OWNER,
            isSystemRole: true,
            invitedBy: userId,
            invitedAtSec: nowSeconds,
            joinedAtSec: nowSeconds,
            nowSec: nowSeconds,
          },
          whenTeamExists(teamId),
        ),
      ]);

      // The batch committed. Either the team row inserted, or a cap guard blocked it (0 changes);
      // neither is retryable — only the slug-collision throw below retries.
      teamCreated = didInsert(results[0]);
      break;
    } catch (error) {
      if (isUniqueConstraintError(error)) continue;
      throw error;
    }
  }

  if (!teamCreated) {
    // The batch wrote no team. One read disambiguates a cap block (for the right error message)
    // from repeated slug collisions across every retry.
    const { teamsOwned: owned, teamsJoined: joined } = await getUserTeamCounts(userId);

    if (joined >= MAX_TEAMS_JOINED_PER_USER) {
      throw new ActionError("FORBIDDEN", {
        key: "Client.Dashboard.Teams.errorJoinLimit",
        params: { max: MAX_TEAMS_JOINED_PER_USER },
      });
    }

    if (owned >= MAX_TEAMS_CREATED_PER_USER) {
      throw new ActionError("FORBIDDEN", {
        key: "Client.Dashboard.Teams.errorCreateLimit",
        params: { max: MAX_TEAMS_CREATED_PER_USER },
      });
    }

    throw new ActionError("ERROR", { key: "Client.Dashboard.Teams.errorSlugGeneration" });
  }

  await updateAllSessionsOfUser(userId);

  return {
    teamId,
    name,
    slug,
  };
}

export const getUserTeams = cache(async (): Promise<TeamSummary[]> => {
  // requireVerifiedEmail throws when there is no verified session, so it always returns one here.
  const session = await requireVerifiedEmail();
  const db = getDB();

  const userTeams = await db.query.teamMembershipTable.findMany({
    where: { userId: session.userId },
    // Only load what the summary DTO exposes; never hydrate billing/Stripe/settings columns.
    // isActive/expiresAt drive the active-membership filter below.
    columns: {
      teamId: true,
      roleId: true,
      isSystemRole: true,
      isActive: true,
      expiresAt: true,
    },
    with: {
      team: {
        columns: {
          id: true,
          name: true,
          slug: true,
          description: true,
          avatarUrl: true,
        },
      },
    },
  });

  // Only list teams the user can actually open. The page guard (requireTeamAccess ->
  // getActiveTeamMembership) 404s inactive/expired memberships, so listing them here would
  // surface teams that 404 on click. Same predicate, one source of truth.
  const activeTeams = userTeams.filter((membership) =>
    isMembershipCurrentlyActive({
      isActive: membership.isActive,
      expiresAt: membership.expiresAt,
    }),
  );

  // System role ids carry their own name; custom roles need a lookup for the display name.
  const customRoleIds = Array.from(new Set(
    activeTeams.filter((membership) => !membership.isSystemRole).map((membership) => membership.roleId),
  ));
  const customRoles = customRoleIds.length === 0
    ? []
    : await db.query.teamRoleTable.findMany({
        where: { id: { in: customRoleIds } },
        columns: { id: true, name: true, teamId: true },
      });
  // Key on (teamId, roleId) so a role only supplies a name for its own team; a membership
  // pointing at another team's roleId resolves to no name, matching resolveMembershipPermissions.
  const customRoleNameByTeamAndId = new Map(
    customRoles.map((role) => [`${role.teamId}:${role.id}`, role.name]),
  );

  // This function doesn't enforce the MAX_TEAMS_JOINED_PER_USER limit directly
  // since it's just retrieving teams, but we use the constant here to show that
  // we're aware of the limit in the system
  if (activeTeams.length > MAX_TEAMS_JOINED_PER_USER) {
    console.warn(`User ${session.userId} has exceeded the maximum teams limit: ${activeTeams.length}/${MAX_TEAMS_JOINED_PER_USER}`);
  }

  return activeTeams.map((membership) => ({
    id: membership.team.id,
    name: membership.team.name,
    slug: membership.team.slug,
    description: membership.team.description,
    avatarUrl: membership.team.avatarUrl,
    role: {
      id: membership.roleId,
      name: membership.isSystemRole
        ? membership.roleId
        : (customRoleNameByTeamAndId.get(`${membership.teamId}:${membership.roleId}`) ?? ""),
    },
  }));
});
