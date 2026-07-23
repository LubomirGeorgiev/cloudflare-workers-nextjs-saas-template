import "server-only";
import { requireVerifiedEmail } from "./auth";
import { ActionError } from "@/lib/action-error";
import { getActiveTeamMembership } from "./team-membership";

// Authorization is D1-authoritative: the KV session provides identity only, and every
// membership/permission decision is made against the current D1 membership + role state
// (via the request-cached getActiveTeamMembership) so revocation and expiry take effect
// immediately rather than waiting for the ~30-day KV session to churn.

// This function doesn't throw exceptions, making it easier to use in pages
export const hasTeamMembership = async (teamId: string) => {
  const session = await requireVerifiedEmail({ doNotThrowError: true });

  if (!session) {
    return { hasAccess: false };
  }

  const membership = await getActiveTeamMembership({ teamId, userId: session.userId });
  const isMember = !!membership;

  return {
    hasAccess: isMember,
    session: isMember ? session : undefined,
  };
};

export const hasTeamPermission = async (teamId: string, permission: string) => {
  const session = await requireVerifiedEmail();

  if (!session) {
    return false;
  }

  const membership = await getActiveTeamMembership({ teamId, userId: session.userId });

  if (!membership) {
    return false;
  }

  return membership.permissions.includes(permission);
};

// Require team permission (throws if doesn't have permission)
export const requireTeamPermission = async (teamId: string, permission: string) => {
  const session = await requireVerifiedEmail();

  if (!session) {
    throw new ActionError("NOT_AUTHORIZED", { key: "Client.Errors.notAuthenticated" });
  }

  const hasPermission = await hasTeamPermission(teamId, permission);

  if (!hasPermission) {
    throw new ActionError("FORBIDDEN", { key: "Client.Dashboard.Teams.errorTeamPermissionRequired" });
  }

  return session;
};
