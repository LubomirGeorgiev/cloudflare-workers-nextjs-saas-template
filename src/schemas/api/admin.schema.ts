import { ROLES_ENUM } from "@/app/enums";
import {
  BAN_REASON_MAX_LENGTH,
  DEFAULT_ADMIN_TABLE_PAGE_SIZE,
  EMAIL_MAX_LENGTH,
  MAX_ADMIN_TABLE_PAGE_SIZE,
} from "@/constants";
import { collectionSchema } from "@/../cms.config";
import { maxString, minMaxString, v } from "@/lib/validation";
import {
  booleanQueryField,
  integerQueryField,
  isoDateSchema,
  nullableIsoDateSchema,
} from "@/schemas/api/common.schema";
import { banDecisionFields } from "@/schemas/admin-users.schema";
import { createBlockedEmailFields } from "@/schemas/admin-blocked-emails.schema";
import { idField } from "@/schemas/fields";
import { BLOCKED_EMAIL_KINDS } from "@/utils/email-pattern";

// Request and response shapes for the *internal* admin API. Machine-facing like the public ones:
// every handler types its mapper as `v.InferOutput<typeof schema>`, and nothing here is translated.
//
// These schemas never reach the published document — they are compiled into the internal one only.

const USER_ROLES = Object.values(ROLES_ENUM);

// A page cursor pair shared by the internal listings, bounded by the same admin-table ceilings the
// panel uses so a machine caller cannot ask for a larger page than a person can.
const pageField = integerQueryField({ min: 1, fallback: 1 });
const pageSizeField = integerQueryField({
  min: 1,
  max: MAX_ADMIN_TABLE_PAGE_SIZE,
  fallback: DEFAULT_ADMIN_TABLE_PAGE_SIZE,
});

export const adminListUsersQuerySchema = v.object({
  page: pageField,
  pageSize: pageSizeField,
  emailFilter: v.optional(maxString(EMAIL_MAX_LENGTH)),
  bannedOnly: v.optional(booleanQueryField()),
});

export const adminUserIdParamSchema = v.object({
  userId: idField("User ID is required"),
});

export const adminSetUserRoleSchema = v.object({
  role: v.picklist(USER_ROLES),
});

export const adminUserSchema = v.object({
  id: v.string(),
  email: v.nullable(v.string()),
  name: v.nullable(v.string()),
  role: v.picklist(USER_ROLES),
  // Email verification only. `bannedAt` is the separate, additive field: widening the meaning of
  // `status` would break every already-configured client that reads it.
  status: v.picklist(["active", "inactive"]),
  createdAt: isoDateSchema,
  lastActiveAt: nullableIsoDateSchema,
  bannedAt: nullableIsoDateSchema,
});

export const adminUserListSchema = v.object({
  users: v.array(adminUserSchema),
  totalCount: v.number(),
  page: v.number(),
  pageSize: v.number(),
  totalPages: v.number(),
});

export const adminListOAuthAppsQuerySchema = v.object({
  page: pageField,
  pageSize: pageSizeField,
});

export const adminOAuthAppClientIdParamSchema = v.object({
  clientId: idField("Client ID is required"),
});

export const adminSetOAuthAppVerifiedSchema = v.object({
  isVerified: v.boolean(),
});

export const adminOAuthAppSchema = v.object({
  clientId: v.string(),
  name: v.nullable(v.string()),
  isVerified: v.boolean(),
  registrationSource: v.nullable(v.string()),
  redirectUris: v.array(v.string()),
  verifiedAt: nullableIsoDateSchema,
  createdAt: isoDateSchema,
});

export const adminOAuthAppListSchema = v.object({
  apps: v.array(adminOAuthAppSchema),
  totalCount: v.number(),
  page: v.number(),
  pageSize: v.number(),
  totalPages: v.number(),
});

// Validated against the deployment's configured collections, never a hard-coded list: a fork that
// renames or adds a collection gets a correct schema without touching this file.
export const adminListCmsEntriesQuerySchema = v.object({
  collection: collectionSchema,
  page: pageField,
  pageSize: pageSizeField,
});

export const adminCmsEntryIdParamSchema = v.object({
  entryId: idField("Entry ID is required"),
});

export const adminCmsEntrySchema = v.object({
  id: v.string(),
  collection: v.string(),
  slug: v.string(),
  title: v.string(),
  status: v.string(),
  locale: v.nullable(v.string()),
  publishedAt: nullableIsoDateSchema,
  updatedAt: nullableIsoDateSchema,
});

export const adminCmsEntryListSchema = v.object({
  entries: v.array(adminCmsEntrySchema),
  totalCount: v.number(),
  page: v.number(),
  pageSize: v.number(),
  totalPages: v.number(),
});

// ---------------------------------------------------------------------------
// Suspension and the registration blocklist.
//
// The two request bodies spread `banDecisionFields`, the same field set the admin form and the
// server actions use, so the notification default is declared exactly once in the codebase.
// ---------------------------------------------------------------------------

export const adminBanUserBodySchema = v.object(banDecisionFields);
export const adminUnbanUserBodySchema = v.object(banDecisionFields);

// Declared once: ban and unban report the same set, so a new outcome cannot reach one door only.
// `queue-failed` means the notice was asked for and the queue write rejected — nothing was sent.
const noticeOutcomeField = v.picklist([
  "queued",
  "queue-failed",
  "not-requested",
  "no-email-address",
]);

export const adminBanResultSchema = v.object({
  userId: v.string(),
  bannedAt: isoDateSchema,
  alreadyBanned: v.boolean(),
  revokedApiKeyCount: v.number(),
  revokedGrantCount: v.number(),
  revokedInvitationCount: v.number(),
  cancelledSubscriptionCount: v.number(),
  // Subscriptions neither Stripe nor the retry queue took. Nothing will cancel them by itself.
  subscriptionCancellationFailedCount: v.number(),
  noticeOutcome: noticeOutcomeField,
});

export const adminUnbanResultSchema = v.object({
  userId: v.string(),
  wasNotBanned: v.boolean(),
  cancelledSubscriptionCount: v.number(),
  noticeOutcome: noticeOutcomeField,
});

const adminBanEventSchema = v.object({
  id: v.string(),
  action: v.picklist(["ban", "unban"]),
  internalReason: v.string(),
  externalReason: v.nullable(v.string()),
  actorUserId: v.nullable(v.string()),
  actorName: v.nullable(v.string()),
  noticeQueuedAt: nullableIsoDateSchema,
  cancelledSubscriptionCount: v.nullable(v.number()),
  createdAt: isoDateSchema,
});

export const adminBanEventListSchema = v.object({
  events: v.array(adminBanEventSchema),
});

export const adminListBlockedEmailsQuerySchema = v.object({
  page: pageField,
  pageSize: pageSizeField,
});

export const adminBlockedEmailIdParamSchema = v.object({
  id: idField("Blocked email ID is required"),
});

export const adminCreateBlockedEmailSchema = v.object(createBlockedEmailFields);

export const adminBlockedEmailSchema = v.object({
  id: v.string(),
  kind: v.picklist(Object.values(BLOCKED_EMAIL_KINDS)),
  value: v.string(),
  pattern: v.string(),
  reason: v.nullable(v.string()),
  createdByUserId: v.nullable(v.string()),
  createdAt: isoDateSchema,
});

export const adminBlockedEmailListSchema = v.object({
  entries: v.array(adminBlockedEmailSchema),
  totalCount: v.number(),
  page: v.number(),
  pageSize: v.number(),
  totalPages: v.number(),
});

export const adminTeamIdParamSchema = v.object({
  teamId: idField("Team ID is required"),
});

export const adminCancelTeamSubscriptionSchema = v.object({
  reason: minMaxString({ min: 1, max: BAN_REASON_MAX_LENGTH }),
});

export const adminCancelTeamSubscriptionResultSchema = v.object({
  cancelled: v.boolean(),
});
