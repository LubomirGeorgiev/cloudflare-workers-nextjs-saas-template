import { emailString, v, validationKey } from "@/lib/validation";
import { idField, teamIdField, tokenField } from "@/schemas/fields";

// `emailString()` carries EMAIL_MAX_LENGTH itself, so this is the shared rule with nothing added.
const teamMemberEmailField = emailString();

// The invite dialog collects only the email; the action adds team + role. Both sides share
// one email rule so client and server can never drift apart.
export const inviteMemberFormSchema = v.object({
  email: teamMemberEmailField,
});

export type InviteMemberFormSchema = v.InferOutput<typeof inviteMemberFormSchema>;

export const inviteUserSchema = v.object({
  teamId: teamIdField(),
  email: teamMemberEmailField,
  roleId: idField(validationKey("roleRequired")),
  isSystemRole: v.optional(v.boolean(), true),
});

export const removeMemberSchema = v.object({
  teamId: teamIdField(),
  userId: idField(validationKey("userIdRequired")),
});

// Dashboard acceptance addresses invitations by id + the session's verified email, never by a
// bearer token.
export const invitationIdSchema = v.object({
  invitationId: idField(validationKey("invitationIdRequired")),
});

export const revokeTeamInvitationSchema = v.object({
  teamId: teamIdField(),
  invitationId: idField(validationKey("invitationIdRequired")),
});

export type RevokeTeamInvitationSchema = v.InferOutput<typeof revokeTeamInvitationSchema>;

export const teamInviteSchema = v.object({
  token: tokenField(validationKey("invitationTokenRequired")),
});
