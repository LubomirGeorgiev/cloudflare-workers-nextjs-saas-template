import "server-only";
import { getDB } from "@/db";
import { SYSTEM_ROLES_ENUM, TEAM_PERMISSIONS, teamMembershipTable, teamRoleTable, teamTable } from "@/db/schema";
import { requireVerifiedEmail } from "@/utils/auth";
import { generateSlug } from "@/utils/slugify";
import { ActionError } from "@/lib/action-error";
import { createId } from "@paralleldrive/cuid2";
import { eq, and, count } from "drizzle-orm";
import { updateAllSessionsOfUser } from "@/utils/kv-session";
import { MAX_TEAMS_CREATED_PER_USER, MAX_TEAMS_JOINED_PER_USER } from "@/constants";

/**
 * Create a new team with the current user as owner
 */
export async function createTeam({
  name,
  description,
  avatarUrl
}: {
  name: string;
  description?: string;
  avatarUrl?: string;
}) {
  // Verify user is authenticated
  const session = await requireVerifiedEmail();
  if (!session) {
    throw new ActionError("NOT_AUTHORIZED", "Not authenticated");
  }

  const userId = session.userId;
  const db = getDB();

  // Check if user has reached their team creation limit
  const ownedTeamsCount = await db.select({ value: count() })
    .from(teamMembershipTable)
    .where(
      and(
        eq(teamMembershipTable.userId, userId),
        eq(teamMembershipTable.roleId, SYSTEM_ROLES_ENUM.OWNER),
        eq(teamMembershipTable.isSystemRole, 1)
      )
    );

  const teamsOwned = ownedTeamsCount[0]?.value || 0;

  if (teamsOwned >= MAX_TEAMS_CREATED_PER_USER) {
    throw new ActionError("FORBIDDEN", `You have reached the limit of ${MAX_TEAMS_CREATED_PER_USER} teams you can create.`);
  }

  // Generate unique slug for the team
  let slug = generateSlug(name);
  let slugIsUnique = false;
  let attempts = 0;

  // Make sure slug is unique
  while (!slugIsUnique && attempts < 5) {
    const existingTeam = await db.query.teamTable.findFirst({
      where: eq(teamTable.slug, slug),
    });

    if (!existingTeam) {
      slugIsUnique = true;
    } else {
      // Add a random suffix to make the slug unique
      slug = `${generateSlug(name)}-${createId().substring(0, 4)}`;
      attempts++;
    }
  }

  if (!slugIsUnique) {
    throw new ActionError("ERROR", "Could not generate a unique slug for the team");
  }

  // Insert the team
  const newTeam = await db.insert(teamTable).values({
    name,
    slug,
    description,
    avatarUrl,
    creditBalance: 0,
  }).returning();

  const team = newTeam?.[0];

  if (!team) {
    throw new ActionError("ERROR", "Could not create team");
  }

  const teamId = team.id;

  // Add the creator as an owner
  await db.insert(teamMembershipTable).values({
    teamId,
    userId,
    roleId: SYSTEM_ROLES_ENUM.OWNER,
    isSystemRole: 1,
    invitedBy: userId,
    invitedAt: new Date(),
    joinedAt: new Date(),
    isActive: 1,
  });

  // Create default custom role for the team
  await db.insert(teamRoleTable).values({
    teamId,
    name: "Editor",
    description: "Can edit team content",
    permissions: [
      TEAM_PERMISSIONS.ACCESS_DASHBOARD,
      TEAM_PERMISSIONS.CREATE_COMPONENTS,
      TEAM_PERMISSIONS.EDIT_COMPONENTS,
    ],
    isEditable: 1,
  });

  // Update the user's session to include the new team
  await updateAllSessionsOfUser(userId);

  return {
    teamId,
    name,
    slug,
  };
}

/**
 * Get all teams for current user
 */
export async function getUserTeams() {
  const session = await requireVerifiedEmail();

  if (!session) {
    throw new ActionError("NOT_AUTHORIZED", "Not authenticated");
  }

  const db = getDB();

  const userTeams = await db.query.teamMembershipTable.findMany({
    where: eq(teamMembershipTable.userId, session.userId),
    with: {
      team: true,
    },
  });

  // This function doesn't enforce the MAX_TEAMS_JOINED_PER_USER limit directly
  // since it's just retrieving teams, but we use the constant here to show that
  // we're aware of the limit in the system
  if (userTeams.length > MAX_TEAMS_JOINED_PER_USER) {
    console.warn(`User ${session.userId} has exceeded the maximum teams limit: ${userTeams.length}/${MAX_TEAMS_JOINED_PER_USER}`);
  }

  return userTeams.map(membership => membership.team);
}
