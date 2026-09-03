import { BAN_REASON_MAX_LENGTH, EMAIL_MAX_LENGTH } from "@/constants";
import { maxString, trimmedString, v } from "@/lib/validation";
import { adminTablePaginationFields, idField } from "@/schemas/fields";

// Admin-only inputs: never typed by a user, so the messages stay inline rather than becoming
// localized validation keys.
const userIdField = idField("User ID is required");

export const revokeUserConnectedAppSchema = v.object({
  userId: userIdField,
  grantId: idField("Grant ID is required"),
});

export const revokeUserApiKeySchema = v.object({
  userId: userIdField,
  keyId: idField("API key ID is required"),
});

export const removeUserFromTeamSchema = v.object({
  userId: userIdField,
  teamId: idField("Team ID is required"),
});

export const getUsersSchema = v.object({
  ...adminTablePaginationFields,
  // A substring match against the email column, so it can never usefully exceed one address.
  emailFilter: v.optional(maxString(EMAIL_MAX_LENGTH)),
  bannedOnly: v.optional(v.boolean()),
});

// The single declaration of what a ban or unban decision is. Both forms, both server actions, and
// both internal routes spread these fields, so the notification default exists exactly once in the
// codebase. A silent ban cannot stop being silent because a second schema drifted, and unban
// cannot quietly behave differently from ban.
export const banDecisionFields = {
  // Staff-only. Required. Never reaches an email payload — there is no field for it there.
  // Trimmed before the length checks, so a reason of pure whitespace is refused rather than stored.
  internalReason: trimmedString({ min: 1, max: BAN_REASON_MAX_LENGTH }),
  // Sent to the user verbatim. Optional: blank means the notice carries no reason block.
  externalReason: v.optional(maxString(BAN_REASON_MAX_LENGTH)),
  sendEmail: v.optional(v.boolean(), true),
};

/**
 * Server actions and client forms: the target travels in the input.
 *
 * Ban carries one field unban has no use for — the convenience checkbox that also adds the
 * account's address to the registration blocklist. The blocklist entry it creates is an ordinary
 * one; the two features stay separate.
 */
export const banUserSchema = v.object({
  userId: userIdField,
  ...banDecisionFields,
  alsoBlockEmail: v.optional(v.boolean(), false),
});

export const unbanUserSchema = v.object({ userId: userIdField, ...banDecisionFields });

// Input and output differ because `sendEmail` and `alsoBlockEmail` carry defaults: react-hook-form
// types the fields it holds from the INPUT, and the action receives the parsed OUTPUT. Both forms
// declare `useForm<Input, unknown, Output>` for that reason.
export type BanUserInput = v.InferInput<typeof banUserSchema>;
export type BanUserSchema = v.InferOutput<typeof banUserSchema>;
export type UnbanUserInput = v.InferInput<typeof unbanUserSchema>;
export type UnbanUserSchema = v.InferOutput<typeof unbanUserSchema>;
