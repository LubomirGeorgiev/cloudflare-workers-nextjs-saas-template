import "server-only";

import { Hono } from "hono";

import { toIsoString, toNullableIsoString } from "@/utils/iso-timestamp";
import { apiValidator } from "@/api/middleware/problem-json";
import { apiOperation } from "@/api/operation";
import { API_TAGS } from "@/api/openapi-document";
import { jsonResponse } from "@/api/openapi";
import type { ApiEnv } from "@/api/types";
import {
  createApiKeyFromInput,
  listTeamApiKeys,
  listUserApiKeys,
  revokeApiKey,
  updateApiKeyScopes,
  type ApiKeySummary,
} from "@/lib/api-keys/api-keys";
import type { v } from "@/lib/validation";
import {
  apiKeyIdParamSchema,
  apiKeyListSchema,
  apiKeySchema,
  createdApiKeySchema,
  listApiKeysQuerySchema,
  updateApiKeyScopesBodySchema,
} from "@/schemas/api/api-keys.schema";
import { successSchema } from "@/schemas/api/common.schema";
import { createApiKeySchema } from "@/schemas/api-key.schema";

// Typed against the documented schema, so the payload and the OpenAPI document cannot drift.
function toApiKeyDto(key: ApiKeySummary): v.InferOutput<typeof apiKeySchema> {
  return {
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    last4: key.last4,
    scopes: key.scopes,
    teamId: key.teamId,
    createdAt: toIsoString(key.createdAt),
    lastUsedAt: toNullableIsoString(key.lastUsedAt),
    expiresAt: toNullableIsoString(key.expiresAt),
  };
}

export const apiKeyRoutes = new Hono<ApiEnv>()
  .get(
    "/api-keys",
    ...apiOperation({
      operationId: "listApiKeys",
      tags: [API_TAGS.apiKeys],
      summary: "List API keys",
      description:
        "Lists the caller's personal API keys, or a team's keys when `teamId` is given (which " +
        "requires the `manage_api_keys` permission on that team). Revoked keys are never listed, " +
        "and no response can ever contain a key's secret. " +
        "Account-level: a team-scoped API key is refused with 403.",
      scope: "api-keys:read",
      audience: "account",
      responses: {
        200: jsonResponse({ description: "The matching API keys.", schema: apiKeyListSchema }),
      },
    }),
    apiValidator("query", listApiKeysQuerySchema),
    async (c) => {
      const { teamId } = c.req.valid("query");

      const keys = teamId ? await listTeamApiKeys({ teamId }) : await listUserApiKeys();

      return c.json(keys.map(toApiKeyDto));
    },
  )
  .post(
    "/api-keys",
    ...apiOperation({
      operationId: "createApiKey",
      tags: [API_TAGS.apiKeys],
      summary: "Create an API key",
      description:
        "Creates an API key for the caller, or for a team when `teamId` is given. The scopes " +
        "requested must be a subset of the calling credential's own scopes. A key created with a " +
        "`teamId` cannot hold a scope this API marks account-only; the refusal names the rejected " +
        "scopes, so ask for a personal key instead when you need those. The `secret` in the " +
        "response is returned exactly once and is not recoverable afterwards. " +
        "Account-level: a team-scoped API key is refused with 403.",
      scope: "api-keys:write",
      audience: "account",
      responses: {
        201: jsonResponse({
          description: "The created key and its one-time secret.",
          schema: createdApiKeySchema,
        }),
      },
    }),
    apiValidator("json", createApiKeySchema),
    async (c) => {
      const created = await createApiKeyFromInput(c.req.valid("json"));

      return c.json({ key: toApiKeyDto(created.key), secret: created.secret }, 201);
    },
  )
  .patch(
    "/api-keys/:keyId",
    ...apiOperation({
      operationId: "updateApiKey",
      tags: [API_TAGS.apiKeys],
      summary: "Update an API key's scopes",
      description:
        "Replaces the scopes granted to an API key; the list is not merged with the key's current " +
        "scopes, so send the full set you want it to end up with. The new scopes must be a subset " +
        "of the calling credential's own scopes. The change takes effect immediately, including " +
        "for the key making the call. Keys belonging to another account, and revoked keys, answer " +
        "404 so key ids cannot be probed. " +
        "Account-level: a team-scoped API key is refused with 403.",
      scope: "api-keys:write",
      audience: "account",
      responses: {
        200: jsonResponse({ description: "The updated key.", schema: apiKeySchema }),
      },
    }),
    apiValidator("param", apiKeyIdParamSchema),
    apiValidator("json", updateApiKeyScopesBodySchema),
    async (c) => {
      const { keyId } = c.req.valid("param");
      const { scopes } = c.req.valid("json");

      return c.json(toApiKeyDto(await updateApiKeyScopes({ keyId, scopes })));
    },
  )
  .delete(
    "/api-keys/:keyId",
    ...apiOperation({
      operationId: "revokeApiKey",
      tags: [API_TAGS.apiKeys],
      summary: "Revoke an API key",
      description:
        "Revokes an API key immediately, including the key making the call. Keys belonging to " +
        "another account answer 404 so key ids cannot be probed. " +
        "Account-level: a team-scoped API key is refused with 403.",
      scope: "api-keys:write",
      audience: "account",
      responses: {
        200: jsonResponse({ description: "The key was revoked.", schema: successSchema }),
      },
    }),
    apiValidator("param", apiKeyIdParamSchema),
    async (c) => {
      return c.json(await revokeApiKey({ keyId: c.req.valid("param").keyId }));
    },
  );
