import {
  API_KEY_MAX_EXPIRY_DAYS,
  API_KEY_NAME_MAX_LENGTH,
  API_SCOPE_NAME_MAX_LENGTH,
} from "@/constants";
import { trimmedString, v } from "@/lib/validation";
import { apiKeyIdField } from "@/schemas/api-key.schema";

// Admin-only inputs: never typed by a customer, so messages stay inline rather than becoming
// localized validation keys, matching `admin-users.schema.ts`.
//
// `scopes` is deliberately bounded strings rather than a picklist. The internal catalog lives in
// `@/lib/api/admin-scopes`, which is `server-only`, and this schema is used by the admin panel's
// client form — picklisting it here would pull the catalog into a client bundle, which is exactly
// the leak this feature exists to prevent. `createAdminApiKey` refuses anything that is not an
// internal scope, so the catalog check happens where the catalog is allowed to be.

/** Generous but finite: the write path decides which of these names actually exist. */
const MAX_REQUESTED_SCOPES = 32;

export const createAdminApiKeySchema = v.object({
  name: trimmedString({
    min: 1,
    max: API_KEY_NAME_MAX_LENGTH,
    minMessage: "A name is required",
    maxMessage: `A name must be at most ${API_KEY_NAME_MAX_LENGTH} characters`,
  }),
  scopes: v.pipe(
    v.array(
      trimmedString({
        min: 1,
        max: API_SCOPE_NAME_MAX_LENGTH,
        minMessage: "A scope is required",
        maxMessage: `A scope must be at most ${API_SCOPE_NAME_MAX_LENGTH} characters`,
      }),
    ),
    v.minLength(1, "Select at least one internal scope"),
    v.maxLength(MAX_REQUESTED_SCOPES),
  ),
  expiresInDays: v.optional(
    v.pipe(
      v.number("Expiry must be a number of days"),
      v.integer("Expiry must be a whole number of days"),
      v.minValue(1, "Expiry must be at least one day"),
      v.maxValue(API_KEY_MAX_EXPIRY_DAYS, `Expiry must be at most ${API_KEY_MAX_EXPIRY_DAYS} days`),
    ),
  ),
});

export type CreateAdminApiKeySchema = v.InferOutput<typeof createAdminApiKeySchema>;

export const revokeAdminApiKeySchema = v.object({
  keyId: apiKeyIdField(),
});
