import "server-only";
import { requireVerifiedEmail } from "./auth";
import { ActionError } from "@/lib/action-error";
import { assertTeamAudience, isTeamInAudience } from "@/lib/api/principal";
import { getActiveTeamMembership } from "./team-membership";

// Authorization is D1-authoritative: the KV session provides identity only, and every
// membership/permission decision is made against the current D1 membership + role state
// (via the request-cached getActiveTeamMembership) so revocation and expiry take effect
// immediately rather than waiting for the ~30-day KV session to churn.
//
// These three are also the audience chokepoint for bearer credentials: a team API key may only
// ever act on the team it was created for, so an individual route cannot forget the check. Like a
// scope, the audience only narrows — a cookie session has none and is unaffected. `has*` probes
// answer false for a foreign team; only `require*` throws, and only once.

// This function doesn't throw exceptions, making it easier to use in pages
export const hasTeamMembership = async (teamId: string) => {
  if (!isTeamInAudience(teamId)) {
    return { hasAccess: false };
  }

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

// A probe, not a gate: an out-of-audience team reads as "no permission" rather than throwing, the
// same soft handling as hasTeamMembership. The `require*` twin below is where the audience throws.
export const hasTeamPermission = async (teamId: string, permission: string) => {
  if (!isTeamInAudience(teamId)) {
    return false;
  }

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

// Require team permission (throws if doesn't have permission). The single audience assert for the
// service layer: the probe below it is soft, so a foreign team is refused here with its own error.
export const requireTeamPermission = async (teamId: string, permission: string) => {
  assertTeamAudience(teamId);
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
