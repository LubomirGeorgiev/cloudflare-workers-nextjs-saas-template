import { OAUTH_QUERY_MAX_LENGTH } from "@/constants";
import { minMaxString, v } from "@/lib/validation";
import { idField } from "@/schemas/fields";

// oxlint-disable project/no-unused-module-exports -- Schemas intentionally export validation contracts and inferred types together.

// The raw authorization query string is round-tripped through the consent form and re-parsed
// server-side: the client never gets to say which scopes were approved, only which button was hit.
export const oauthConsentSchema = v.object({
  authQuery: minMaxString({ min: 1, max: OAUTH_QUERY_MAX_LENGTH }),
  decision: v.picklist(["approve", "deny"]),
});

// fallow-ignore-next-line unused-type
export type OAuthConsentSchema = v.InferOutput<typeof oauthConsentSchema>;

export const revokeOAuthGrantSchema = v.object({
  grantId: idField(),
});

// fallow-ignore-next-line unused-type
export type RevokeOAuthGrantSchema = v.InferOutput<typeof revokeOAuthGrantSchema>;

export const oauthAppClientIdSchema = v.object({
  clientId: idField(),
});

// fallow-ignore-next-line unused-type
export type OAuthAppClientIdSchema = v.InferOutput<typeof oauthAppClientIdSchema>;

export const setOAuthAppVerifiedSchema = v.object({
  clientId: idField(),
  isVerified: v.boolean(),
});

// fallow-ignore-next-line unused-type
export type SetOAuthAppVerifiedSchema = v.InferOutput<typeof setOAuthAppVerifiedSchema>;

export const listOAuthAppsSchema = v.object({
  page: v.pipe(v.number(), v.integer(), v.minValue(1)),
  pageSize: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

// fallow-ignore-next-line unused-type
export type ListOAuthAppsSchema = v.InferOutput<typeof listOAuthAppsSchema>;

export const oauthVerifyClientSchema = v.object({
  authQuery: oauthConsentSchema.entries.authQuery,
});

// oxlint-enable project/no-unused-module-exports
