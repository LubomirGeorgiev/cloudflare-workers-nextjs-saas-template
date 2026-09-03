import { BAN_REASON_MAX_LENGTH, EMAIL_MAX_LENGTH, TEAM_NAME_MAX_LENGTH } from "@/constants";
import { maxString, minMaxString, trimmedString, v } from "@/lib/validation";
import { adminTablePaginationFields, idField } from "@/schemas/fields";

// Admin-only inputs: never typed by a customer, so the messages stay inline rather than becoming
// localized validation keys — the same rule `admin-users.schema.ts` follows.
const teamIdField = idField("Team ID is required");
const userIdField = idField("User ID is required");

export const getTeamsSchema = v.object({
  ...adminTablePaginationFields,
  // Matched as a substring against the team name, the slug, and member emails, so the longest of
  // those columns is the useful ceiling.
  search: v.optional(maxString(EMAIL_MAX_LENGTH)),
});

export const setTeamNameSchema = v.object({
  teamId: teamIdField,
  name: trimmedString({
    min: 1,
    max: TEAM_NAME_MAX_LENGTH,
    minMessage: "Team name is required",
    maxMessage: `Team name must be ${TEAM_NAME_MAX_LENGTH} characters or fewer`,
  }),
});

export const removeTeamMemberSchema = v.object({
  teamId: teamIdField,
  userId: userIdField,
});

export const cancelTeamSubscriptionSchema = v.object({
  teamId: teamIdField,
  // Reaches Stripe as `cancellation_details.comment`, so it becomes part of the billing record.
  // Required: an unexplained staff cancellation is not something finance can reconstruct later.
  reason: minMaxString({
    min: 1,
    max: BAN_REASON_MAX_LENGTH,
    minMessage: "A reason is required",
  }),
});

export type CancelTeamSubscriptionSchema = v.InferOutput<typeof cancelTeamSubscriptionSchema>;
