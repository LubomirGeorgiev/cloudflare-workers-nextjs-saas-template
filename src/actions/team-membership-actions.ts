"use server";

import { actionClient } from "@/lib/safe-action";
import { runVerifiedAction } from "@/lib/verified-action";
import {
  removeTeamMember,
  getPendingInvitationsForCurrentUser
} from "@/lib/teams/team-members";
import { inviteUserToTeam } from "@/lib/teams/team-invite";
import { acceptTeamInvitationById } from "@/lib/teams/team-invitation-accept";
import { revokeTeamInvitation } from "@/lib/teams/team-invitation-revoke";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { emailString, encodeValidationMessage, requiredString, v, validationKey } from "@/lib/validation";
import { revokeTeamInvitationSchema } from "@/schemas/team-invitation.schema";

// Invite user schema
const inviteUserSchema = v.object({
  teamId: requiredString(validationKey("teamIdRequired")),
  email: v.pipe(emailString(), v.maxLength(255, encodeValidationMessage("emailMaxLength", { max: 255 }))),
  roleId: requiredString(validationKey("roleRequired")),
  isSystemRole: v.optional(v.boolean(), true),
});

const removeMemberSchema = v.object({
  teamId: requiredString(validationKey("teamIdRequired")),
  userId: requiredString(validationKey("userIdRequired")),
});

// Dashboard acceptance addresses invitations by id + the session's verified email, never by a
// bearer token.
const invitationIdSchema = v.object({
  invitationId: requiredString(validationKey("invitationIdRequired")),
});

export const inviteUserAction = actionClient
  .inputSchema(inviteUserSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        return runVerifiedAction({
          actionName: "Failed to invite user",
          failureMessageKey: "Client.Dashboard.Teams.toastInviteError",
          handler: () => inviteUserToTeam(input),
        });
      },
      RATE_LIMITS.TEAM_INVITE
    );
  });

export const removeTeamMemberAction = actionClient
  .inputSchema(removeMemberSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        return runVerifiedAction({
          actionName: "Failed to remove team member",
          failureMessageKey: "Client.Dashboard.Teams.toastRemoveError",
          handler: () => removeTeamMember(input),
        });
      },
      RATE_LIMITS.SETTINGS
    );
  });

export const revokeTeamInvitationAction = actionClient
  .inputSchema(revokeTeamInvitationSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        return runVerifiedAction({
          actionName: "Failed to revoke team invitation",
          failureMessageKey: "Client.Dashboard.Teams.toastRevokeInvitationError",
          handler: () => revokeTeamInvitation(input),
        });
      },
      RATE_LIMITS.SETTINGS
    );
  });

export const acceptInvitationAction = actionClient
  .inputSchema(invitationIdSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        return runVerifiedAction({
          actionName: "Failed to accept invitation",
          failureMessageKey: "Client.Dashboard.Teams.errorAcceptInvitation",
          handler: () => acceptTeamInvitationById(input.invitationId),
        });
      },
      // Acceptance sends no email; SETTINGS is the correct mutation bucket (matches member removal).
      RATE_LIMITS.SETTINGS
    );
  });

export const getPendingInvitationsForCurrentUserAction = actionClient
  .action(async () => {
    return runVerifiedAction({
      actionName: "Failed to get pending team invitations",
      failureMessageKey: "Client.Dashboard.Teams.errorGetPendingInvitations",
      handler: getPendingInvitationsForCurrentUser,
    });
  });
