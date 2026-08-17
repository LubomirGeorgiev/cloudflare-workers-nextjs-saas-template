import type { ActionErrorMessageKey, ActionErrorMessageParams } from "@/lib/action-error";

// Service-layer errors carry a `Client.*` catalog key, never prose, so the RFC 9457 mapper would
// otherwise flatten every distinct reason into the one sentence its status code has. That is what
// an MCP agent reads: "This credential is not allowed to perform this operation" for a full seat
// plan sends it hunting for a missing scope. These are the reasons a caller can act on, restated
// as the untranslated prose `detail` is contractually required to be. Anything not listed still
// falls back to the per-code default, so this table never has to be exhaustive.
//
// Keep entries actionable: name the thing that blocked the call and the operation that unblocks it.
type ProblemDetailFactory = string | ((params: ActionErrorMessageParams) => string);

// Keyed by the same catalog paths the throw sites use, so a renamed or misspelled key is a
// compile error rather than a row that silently stops matching.
export const PROBLEM_DETAIL_BY_MESSAGE_KEY: Partial<
  Record<ActionErrorMessageKey, ProblemDetailFactory>
> = {
  // Teams: membership, limits, and lifecycle.
  "Client.Errors.notAuthenticated": "This request carries no authenticated credential.",
  "Client.Errors.notAuthorized": "This credential may not act on this resource.",
  "Client.Errors.emailVerificationRequired":
    "The account behind this credential has not verified its email address.",
  "Client.Dashboard.Teams.errorTeamNotFound": "No team exists with that id.",
  "Client.Dashboard.Teams.errorTeamPermissionRequired":
    "Your membership of this team does not carry the permission this operation requires.",
  "Client.Dashboard.Teams.errorCreateLimit": ({ max }) =>
    `You have reached the limit of ${max} teams you can create.`,
  "Client.Dashboard.Teams.errorJoinLimit": ({ max }) =>
    `You have reached the limit of ${max} teams you can belong to.`,
  "Client.Dashboard.Teams.errorSlugGeneration":
    "A unique slug could not be derived from that team name. Try a different name.",

  // Invitations: the seat cap and the role argument are the two things a caller gets wrong.
  "Client.Dashboard.Teams.seatLimitReached": ({ seats }) =>
    `This team's plan includes ${seats} seat${seats === 1 ? "" : "s"}, all taken by members or ` +
    "pending invitations. Remove a member, revoke a pending invitation, or upgrade the team's " +
    "plan before inviting again.",
  "Client.Dashboard.Teams.errorInvalidRole":
    "No system role has that id. Call listTeamRoles for the ids this team accepts, and pass " +
    "`isSystemRole: false` when the role is one the team defined itself.",
  "Client.Dashboard.Teams.errorRoleNotFound":
    "This team has no custom role with that id. Call listTeamRoles for the ids it accepts.",
  "Client.Dashboard.Teams.errorOwnerViaInvite":
    "The owner role cannot be granted by invitation; a team has exactly one owner.",
  "Client.Dashboard.Teams.errorNoPermissionAssignRole":
    "Assigning a role other than the default requires the `assign_roles` or " +
    "`change_member_roles` permission.",
  "Client.Dashboard.Teams.errorCannotAssignPermissions":
    "That role grants permissions you do not hold yourself, which would be an escalation.",
  "Client.Dashboard.Teams.errorInvitationNotFound":
    "No pending invitation exists with that id; it may already have been accepted or revoked.",
  "Client.Dashboard.Teams.errorInvitationExpired": "That invitation has expired.",
  "Client.Dashboard.Teams.errorInvitationAlreadyAccepted":
    "That invitation has already been accepted.",
  "Client.Dashboard.Teams.errorInvitationWrongEmail":
    "That invitation was issued to a different email address.",
  "Client.Dashboard.Teams.errorAlreadyOnTeam": "That user is already a member of this team.",

  // Members.
  "Client.Dashboard.Teams.errorMembershipNotFound": "That user is not a member of this team.",
  "Client.Dashboard.Teams.errorCannotRemoveOwner":
    "The team owner cannot be removed. Transfer ownership first.",

  // Account and credentials.
  "Client.Settings.ApiKeys.errorKeyNotFound": "No API key exists with that id on this account.",
  "Client.Settings.ApiKeys.errorInvalidScope":
    "One of the requested scopes is not in this API's scope catalog.",
  "Client.Settings.ApiKeys.errorScopesRequired": "An API key must be created with at least one scope.",
  "Client.Settings.ApiKeys.errorUserLimitReached": ({ max }) =>
    `This account already holds the maximum of ${max} live personal API keys. Revoke a key it no ` +
    "longer uses before creating another; revoked and expired keys do not count.",
  "Client.Settings.ApiKeys.errorTeamLimitReached": ({ max }) =>
    `This team already holds the maximum of ${max} live API keys. Revoke a key it no longer uses ` +
    "before creating another; revoked and expired keys do not count.",
  "Client.Settings.ApiKeys.errorTeamKeyOtherTeam": ({ teamId }) =>
    `This API key is scoped to team ${teamId} and can only act on that team. Address that team ` +
    "instead, or use a key created for the team you want, or a personal key.",
  "Client.Settings.ApiKeys.errorTeamKeyAccountOnly": ({ teamId }) =>
    `This API key is scoped to team ${teamId}, so it cannot reach account-level operations such ` +
    "as the account profile, sign-in sessions, team creation, or API key management. Use a " +
    "personal API key — one created without a team — for those.",
  "Client.Settings.Profile.errorUpdateFailed": "The profile update could not be saved.",

  // Billing.
  "Client.Dashboard.Billing.errorTrialUnavailable":
    "This team is not eligible for a trial on that plan.",
  "Client.Dashboard.Billing.errorStartCheckout": "A checkout session could not be started.",
};

export function resolveKeyedProblemDetail({
  messageKey,
  messageParams,
}: {
  messageKey: ActionErrorMessageKey;
  messageParams?: ActionErrorMessageParams;
}): string | undefined {
  const detail = PROBLEM_DETAIL_BY_MESSAGE_KEY[messageKey];

  if (typeof detail === "function") {
    return detail(messageParams ?? {});
  }

  return detail;
}
