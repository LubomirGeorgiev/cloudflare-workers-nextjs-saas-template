import "server-only";
import { cache } from "react";
import { requireVerifiedEmail } from "./auth";
import { ActionError } from "@/lib/action-error";

// This function doesn't throw exceptions, making it easier to use in pages
export const hasTeamMembership = cache(async (teamId: string) => {
  const session = await requireVerifiedEmail();

  if (!session) {
    return { hasAccess: false };
  }

  const isMember = session.teams?.some(team => team.id === teamId) || false;

  return {
    hasAccess: isMember,
    session: isMember ? session : undefined
  };
});

export const hasTeamPermission = cache(async (teamId: string, permission: string) => {
  const session = await requireVerifiedEmail();

  if (!session) {
    return false;
  }

  const team = session.teams?.find(t => t.id === teamId);

  if (!team) {
    return false;
  }

  return team.permissions.includes(permission);
});

// Require team permission (throws if doesn't have permission)
export const requireTeamPermission = cache(async (teamId: string, permission: string) => {
  const session = await requireVerifiedEmail();

  if (!session) {
    throw new ActionError("NOT_AUTHORIZED", { key: "Client.Errors.notAuthenticated" });
  }

  const hasPermission = await hasTeamPermission(teamId, permission);

  if (!hasPermission) {
    throw new ActionError("FORBIDDEN", { key: "Client.Dashboard.Teams.errorTeamPermissionRequired" });
  }

  return session;
});
