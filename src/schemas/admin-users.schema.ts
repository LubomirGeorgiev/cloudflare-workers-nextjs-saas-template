import { DEFAULT_ADMIN_TABLE_PAGE_SIZE, EMAIL_MAX_LENGTH, MAX_ADMIN_TABLE_PAGE_SIZE } from "@/constants";
import { maxString, v } from "@/lib/validation";
import { idField } from "@/schemas/fields";

// Admin-only inputs: never typed by a user, so the messages stay inline rather than becoming
// localized validation keys.
const userIdField = idField("User ID is required");

export const getUserDataSchema = v.object({
  userId: userIdField,
});

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
  page: v.optional(v.pipe(v.number(), v.minValue(1)), 1),
  pageSize: v.optional(
    v.pipe(v.number(), v.minValue(1), v.maxValue(MAX_ADMIN_TABLE_PAGE_SIZE)),
    DEFAULT_ADMIN_TABLE_PAGE_SIZE,
  ),
  // A substring match against the email column, so it can never usefully exceed one address.
  emailFilter: v.optional(maxString(EMAIL_MAX_LENGTH)),
});
