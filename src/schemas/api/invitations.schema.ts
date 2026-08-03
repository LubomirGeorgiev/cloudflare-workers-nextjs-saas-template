import { SYSTEM_ROLES_ENUM } from "@/db/schema";
import { v } from "@/lib/validation";
import { isoDateSchema } from "@/schemas/api/common.schema";
import { inviteUserSchema } from "@/schemas/team-membership.schema";

const invitationBody = v.omit(inviteUserSchema, ["teamId"]);

// The role an omitted `roleId` resolves to: the least-privileged role every team has, so a
// caller who only wants to add someone never has to discover an id first.
export const DEFAULT_INVITATION_ROLE_ID: string = SYSTEM_ROLES_ENUM.MEMBER;

// `teamId` comes from the path; the body carries only what identifies the invitee and role.
// `roleId` reuses the shared field rule but becomes optional here — the dashboard always sends
// one, while an agent inviting over the API has no way to guess a value without listTeamRoles.
export const createInvitationSchema = v.object({
  ...invitationBody.entries,
  roleId: v.optional(invitationBody.entries.roleId, DEFAULT_INVITATION_ROLE_ID),
});

export const invitationSchema = v.object({
  id: v.string(),
  email: v.string(),
  roleId: v.string(),
  roleName: v.nullable(v.string()),
  isSystemRole: v.boolean(),
  createdAt: isoDateSchema,
  expiresAt: isoDateSchema,
});

export const invitationListSchema = v.array(invitationSchema);

const teamRoleSchema = v.object({
  // Pass this back as `roleId` to createTeamInvitation, with the matching `isSystemRole`.
  roleId: v.string(),
  // Custom roles carry a user-defined name; system roles report null and are labelled from the id.
  name: v.nullable(v.string()),
  isSystemRole: v.boolean(),
  isAssignable: v.boolean(),
  permissions: v.array(v.string()),
});

export const teamRoleListSchema = v.array(teamRoleSchema);
