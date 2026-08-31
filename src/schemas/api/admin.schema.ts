import { ROLES_ENUM } from "@/app/enums";
import {
  DEFAULT_ADMIN_TABLE_PAGE_SIZE,
  EMAIL_MAX_LENGTH,
  MAX_ADMIN_TABLE_PAGE_SIZE,
} from "@/constants";
import { collectionSchema } from "@/../cms.config";
import { maxString, v } from "@/lib/validation";
import {
  integerQueryField,
  isoDateSchema,
  nullableIsoDateSchema,
} from "@/schemas/api/common.schema";
import { idField } from "@/schemas/fields";

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
  status: v.picklist(["active", "inactive"]),
  createdAt: isoDateSchema,
  lastActiveAt: nullableIsoDateSchema,
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
