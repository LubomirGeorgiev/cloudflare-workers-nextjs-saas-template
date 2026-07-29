import { emailString, encodeValidationMessage, requiredString, v, validationKey } from "@/lib/validation";

const teamMemberEmailField = v.pipe(
  emailString(),
  v.maxLength(255, encodeValidationMessage("emailMaxLength", { max: 255 })),
);

// The invite dialog collects only the email; the action adds team + role. Both sides share
// one email rule so client and server can never drift apart.
export const inviteMemberFormSchema = v.object({
  email: teamMemberEmailField,
});

export type InviteMemberFormSchema = v.InferOutput<typeof inviteMemberFormSchema>;

export const inviteUserSchema = v.object({
  teamId: requiredString(validationKey("teamIdRequired")),
  email: teamMemberEmailField,
  roleId: requiredString(validationKey("roleRequired")),
  isSystemRole: v.optional(v.boolean(), true),
});

export const removeMemberSchema = v.object({
  teamId: requiredString(validationKey("teamIdRequired")),
  userId: requiredString(validationKey("userIdRequired")),
});

// Dashboard acceptance addresses invitations by id + the session's verified email, never by a
// bearer token.
export const invitationIdSchema = v.object({
  invitationId: requiredString(validationKey("invitationIdRequired")),
});

export const revokeTeamInvitationSchema = v.object({
  teamId: requiredString(validationKey("teamIdRequired")),
  invitationId: requiredString(validationKey("invitationIdRequired")),
});

export type RevokeTeamInvitationSchema = v.InferOutput<typeof revokeTeamInvitationSchema>;

export const teamInviteSchema = v.object({
  token: requiredString(validationKey("invitationTokenRequired")),
});
