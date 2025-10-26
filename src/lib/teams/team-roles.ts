import "server-only";
import { getDB } from "@/db";
import { TEAM_PERMISSIONS, teamRoleTable } from "@/db/schema";
import { ZSAError } from "zsa";
import { eq, and, not } from "drizzle-orm";
import { requireTeamPermission } from "@/utils/team-auth";

/**
 * Get all custom roles for a team
 */
export async function getTeamRoles(teamId: string) {
  // Check if user has access to the team
  await requireTeamPermission(teamId, TEAM_PERMISSIONS.ACCESS_DASHBOARD);

  const db = getDB();

  const roles = await db.query.teamRoleTable.findMany({
    where: eq(teamRoleTable.teamId, teamId),
  });

  return roles.map(role => ({
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: role.permissions as string[],
    isEditable: Boolean(role.isEditable),
    metadata: role.metadata,
  }));
}

/**
 * Create a new custom role for a team
 */
export async function createTeamRole({
  teamId,
  name,
  description,
  permissions,
  metadata
}: {
  teamId: string;
  name: string;
  description?: string;
  permissions: string[];
  metadata?: Record<string, unknown>;
}) {
  // Check if user has permission to create roles
  await requireTeamPermission(teamId, TEAM_PERMISSIONS.CREATE_ROLES);

  const db = getDB();

  // Check if a role with the same name already exists
  const existingRole = await db.query.teamRoleTable.findFirst({
    where: and(
      eq(teamRoleTable.teamId, teamId),
      eq(teamRoleTable.name, name)
    ),
  });

  if (existingRole) {
    throw new ZSAError("CONFLICT", "A role with this name already exists");
  }

  const newRole = await db.insert(teamRoleTable).values({
    teamId,
    name,
    description,
    permissions,
    metadata: metadata ? JSON.stringify(metadata) : null,
    isEditable: 1,
  }).returning();

  const role = newRole?.[0];

  if (!role) {
    throw new ZSAError("ERROR", "Could not create role");
  }

  return {
    id: role.id,
    name,
    description,
    permissions,
    isEditable: true,
    metadata,
  };
}

/**
 * Update an existing team role
 */
export async function updateTeamRole({
  teamId,
  roleId,
  data
}: {
  teamId: string;
  roleId: string;
  data: {
    name?: string;
    description?: string;
    permissions?: string[];
    metadata?: Record<string, unknown>;
  };
}) {
  // Check if user has permission to edit roles
  await requireTeamPermission(teamId, TEAM_PERMISSIONS.EDIT_ROLES);

  const db = getDB();

  // Find the role to update
  const role = await db.query.teamRoleTable.findFirst({
    where: and(
      eq(teamRoleTable.id, roleId),
      eq(teamRoleTable.teamId, teamId)
    ),
  });

  if (!role) {
    throw new ZSAError("NOT_FOUND", "Role not found");
  }

  // Prevent editing non-editable roles
  if (!role.isEditable) {
    throw new ZSAError("FORBIDDEN", "This role cannot be edited");
  }

  // Check if the new name would conflict with an existing role
  if (data.name && data.name !== role.name) {
    const existingRole = await db.query.teamRoleTable.findFirst({
      where: and(
        eq(teamRoleTable.teamId, teamId),
        eq(teamRoleTable.name, data.name),
        not(eq(teamRoleTable.id, roleId))
      ),
    });

    if (existingRole) {
      throw new ZSAError("CONFLICT", "A role with this name already exists");
    }
  }

  // Update the role
  const updateData: Record<string, unknown> = {};

  if (data.name) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.permissions) updateData.permissions = data.permissions;
  if (data.metadata !== undefined) {
    updateData.metadata = data.metadata ? JSON.stringify(data.metadata) : null;
  }

  await db.update(teamRoleTable)
    .set({
      ...updateData,
      updatedAt: new Date(),
    })
    .where(eq(teamRoleTable.id, roleId));

  return {
    id: roleId,
    name: data.name || role.name,
    description: data.description !== undefined ? data.description : role.description,
    permissions: data.permissions || role.permissions,
    isEditable: Boolean(role.isEditable),
    metadata: data.metadata !== undefined ? data.metadata : role.metadata,
  };
}

/**
 * Delete a team role
 */
export async function deleteTeamRole({
  teamId,
  roleId
}: {
  teamId: string;
  roleId: string;
}) {
  // Check if user has permission to delete roles
  await requireTeamPermission(teamId, TEAM_PERMISSIONS.DELETE_ROLES);

  const db = getDB();

  // Find the role to delete
  const role = await db.query.teamRoleTable.findFirst({
    where: and(
      eq(teamRoleTable.id, roleId),
      eq(teamRoleTable.teamId, teamId)
    ),
  });

  if (!role) {
    throw new ZSAError("NOT_FOUND", "Role not found");
  }

  // Prevent deleting non-editable roles
  if (!role.isEditable) {
    throw new ZSAError("FORBIDDEN", "This role cannot be deleted");
  }

  // Delete the role
  await db.delete(teamRoleTable)
    .where(eq(teamRoleTable.id, roleId));

  return { success: true };
}
