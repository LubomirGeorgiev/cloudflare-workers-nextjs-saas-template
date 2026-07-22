import "server-only";

import { TEAM_PERMISSIONS } from "@/db/schema";

const activeTeamPermissions = new Set<string>(Object.values(TEAM_PERMISSIONS));

export function filterActiveTeamPermissions(permissions: string[]): string[] {
  return permissions.filter((permission) => activeTeamPermissions.has(permission));
}
