import { v } from "@/lib/validation";
import { apiKeyIdField, apiKeyScopesField } from "@/schemas/api-key.schema";
import { teamIdField } from "@/schemas/fields";
import { isoDateSchema, nullableIsoDateSchema } from "@/schemas/api/common.schema";

/** `GET /api-keys`: personal keys by default, a team's keys when `teamId` is given. */
// Request-side input; the handler reads the parsed value off the validator, so no exported type.
export const listApiKeysQuerySchema = v.object({
  teamId: v.optional(teamIdField()),
});

/** The `:keyId` path parameter both key-scoped routes validate. */
export const apiKeyIdParamSchema = v.object({
  keyId: apiKeyIdField(),
});

/** `PATCH /api-keys/{keyId}` body: the path already carries the id, so only scopes travel here. */
export const updateApiKeyScopesBodySchema = v.object({
  scopes: apiKeyScopesField,
});

export const apiKeySchema = v.object({
  id: v.string(),
  name: v.string(),
  keyPrefix: v.string(),
  last4: v.string(),
  scopes: v.array(v.string()),
  teamId: v.nullable(v.string()),
  createdAt: isoDateSchema,
  lastUsedAt: nullableIsoDateSchema,
  expiresAt: nullableIsoDateSchema,
});

export const apiKeyListSchema = v.array(apiKeySchema);

export const createdApiKeySchema = v.object({
  key: apiKeySchema,
  // Returned exactly once, at creation; no endpoint can ever show it again.
  secret: v.string(),
});
