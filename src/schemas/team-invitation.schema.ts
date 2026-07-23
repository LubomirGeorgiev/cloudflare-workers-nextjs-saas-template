import { requiredString, v, validationKey } from "@/lib/validation";

export const revokeTeamInvitationSchema = v.object({
  teamId: requiredString(validationKey("teamIdRequired")),
  invitationId: requiredString(validationKey("invitationIdRequired")),
});

export type RevokeTeamInvitationSchema = v.InferOutput<typeof revokeTeamInvitationSchema>;
