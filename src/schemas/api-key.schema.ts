import { API_KEY_MAX_EXPIRY_DAYS, API_KEY_NAME_MAX_LENGTH } from "@/constants";
import { API_SCOPE_NAMES } from "@/lib/api/scopes";
import { teamIdField } from "@/schemas/fields";
import { encodeValidationMessage, trimmedString, v, validationKey } from "@/lib/validation";
import { idField } from "@/schemas/fields";

const API_KEY_NAME_REQUIRED_MESSAGE = validationKey("apiKeyNameRequired");
const API_KEY_SCOPES_REQUIRED_MESSAGE = validationKey("apiKeyScopesRequired");

const apiKeyNameField = trimmedString({
  min: 1,
  max: API_KEY_NAME_MAX_LENGTH,
  minMessage: API_KEY_NAME_REQUIRED_MESSAGE,
  maxMessage: encodeValidationMessage("apiKeyNameMaxLength", { max: API_KEY_NAME_MAX_LENGTH }),
});

/** The key id, wherever it arrives: a form body, an action input, or a REST path parameter. */
export function apiKeyIdField() {
  return idField(validationKey("apiKeyIdRequired"));
}

// Capped at the catalog size: every scope at once is the most a key can ever legitimately hold,
// and duplicates buy a caller nothing but work for us.
export const apiKeyScopesField = v.pipe(
  v.array(v.picklist(API_SCOPE_NAMES, validationKey("apiKeyInvalidScope"))),
  v.minLength(1, API_KEY_SCOPES_REQUIRED_MESSAGE),
  v.maxLength(API_SCOPE_NAMES.length),
);

// Omitted = never expires. Days rather than a date so the client never has to agree with the
// server about time zones.
const apiKeyExpiryField = v.pipe(
  v.number(validationKey("apiKeyInvalidExpiry")),
  v.integer(validationKey("apiKeyInvalidExpiry")),
  v.minValue(1, validationKey("apiKeyInvalidExpiry")),
  v.maxValue(
    API_KEY_MAX_EXPIRY_DAYS,
    encodeValidationMessage("apiKeyExpiryMaxDays", { max: API_KEY_MAX_EXPIRY_DAYS }),
  ),
);

export const createApiKeySchema = v.object({
  name: apiKeyNameField,
  scopes: apiKeyScopesField,
  teamId: v.optional(teamIdField()),
  expiresInDays: v.optional(apiKeyExpiryField),
});

export type CreateApiKeySchema = v.InferOutput<typeof createApiKeySchema>;

export const revokeApiKeySchema = v.object({
  keyId: apiKeyIdField(),
});

// Scopes only: renaming a key is cosmetic, while extending its life without re-issuing the secret
// is a different risk posture, so neither is editable here.
export const updateApiKeyScopesSchema = v.object({
  keyId: apiKeyIdField(),
  scopes: apiKeyScopesField,
});

export type UpdateApiKeyScopesSchema = v.InferOutput<typeof updateApiKeyScopesSchema>;
