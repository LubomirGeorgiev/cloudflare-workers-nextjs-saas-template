import { sqliteTable, integer, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { defineRelations, type InferSelectModel, sql } from "drizzle-orm";

import { createId } from '@paralleldrive/cuid2'
import { CMS_ENTRY_STATUS, ROLES_ENUM } from "@/app/enums";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import type { JSONContent } from "@tiptap/core"
import { cmsNavigationKeys, type CmsNavigationKey } from "@/../cms.config";
import { cmsEntryStatusTuple, type CmsEntryStatus, type SourceContentHashes } from "@/types/cms";
import {
  cmsNavigationNodeTypeTuple,
  type CmsNavigationNodeType,
} from "@/types/cms-navigation";
import type { ScheduledJobPayload, ScheduledJobType } from "@/lib/scheduler/jobs";
import type { CollectionsUnion } from "../../cms.config";

const roleTuple = Object.values(ROLES_ENUM) as [string, ...string[]];

const commonColumns = {
  createdAt: integer({
    mode: "timestamp",
  }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer({
    mode: "timestamp",
  }).$onUpdateFn(() => new Date()).notNull(),
  updateCounter: integer().default(0).$onUpdate(() => sql`updateCounter + 1`),
}

export const userTable = sqliteTable("user", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `usr_${createId()}`).notNull(),
  firstName: text({
    length: 255,
  }),
  lastName: text({
    length: 255,
  }),
  email: text({
    length: 255,
  }),
  passwordHash: text(),
  role: text({
    enum: roleTuple,
  }).default(ROLES_ENUM.USER).notNull(),
  emailVerified: integer({
    mode: "timestamp",
  }),
  signUpIpAddress: text({
    length: 100,
  }),
  googleAccountId: text({
    length: 255,
  }),
  /**
   * This can either be an absolute or relative path to an image
   */
  avatar: text({
    length: 600,
  }),
  // User's explicit UI language (BCP-47 short code, e.g. "en"/"es"). Null = not set;
  // negotiate from cookie/Accept-Language instead. Validated against LOCALES in app code.
  preferredLocale: text({ length: 10 }),
  // Set when this user starts a free trial on any team, so trials can't be farmed by
  // creating fresh teams. Checked together with team.trialUsedAt for eligibility.
  trialUsedAt: integer({ mode: "timestamp" }),
}, (table) => ([
  index('email_idx').on(table.email),
  index('google_account_id_idx').on(table.googleAccountId),
  index('role_idx').on(table.role),
  uniqueIndex('user_email_unique').on(table.email),
]));

export const passKeyCredentialTable = sqliteTable("passkey_credential", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `pkey_${createId()}`).notNull(),
  userId: text().notNull().references(() => userTable.id),
  credentialId: text({
    length: 255,
  }).notNull(),
  credentialPublicKey: text({
    length: 255,
  }).notNull(),
  counter: integer().notNull(),
  // Optional array of AuthenticatorTransport as JSON string
  transports: text({
    length: 255,
  }),
  // Authenticator Attestation GUID. We use this to identify the device/authenticator app that created the passkey
  aaguid: text({
    length: 255,
  }),
  // The user agent of the device that created the passkey
  userAgent: text({
    length: 255,
  }),
  // The IP address that created the passkey
  ipAddress: text({
    length: 100,
  }),
}, (table) => ([
  index('user_id_idx').on(table.userId),
  index('credential_id_idx').on(table.credentialId),
  uniqueIndex('passkey_credential_credentialId_unique').on(table.credentialId),
]));

// System-defined roles - these are always available
export const SYSTEM_ROLES_ENUM = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
  GUEST: 'guest',
} as const;

export const systemRoleTuple = Object.values(SYSTEM_ROLES_ENUM) as [string, ...string[]];

// Define available permissions
export const TEAM_PERMISSIONS = {
  // Resource access
  ACCESS_DASHBOARD: 'access_dashboard',
  ACCESS_BILLING: 'access_billing',

  // User management
  INVITE_MEMBERS: 'invite_members',
  REMOVE_MEMBERS: 'remove_members',
  CHANGE_MEMBER_ROLES: 'change_member_roles',

  // Team management
  EDIT_TEAM_SETTINGS: 'edit_team_settings',
  DELETE_TEAM: 'delete_team',

  // Role management
  CREATE_ROLES: 'create_roles',
  EDIT_ROLES: 'edit_roles',
  DELETE_ROLES: 'delete_roles',
  ASSIGN_ROLES: 'assign_roles',

  // Content permissions
  CREATE_COMPONENTS: 'create_components',
  EDIT_COMPONENTS: 'edit_components',
  DELETE_COMPONENTS: 'delete_components',

} as const;

// Team table
export const teamTable = sqliteTable("team", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `team_${createId()}`).notNull(),
  name: text({ length: 255 }).notNull(),
  slug: text({ length: 255 }).notNull(),
  description: text({ length: 1000 }),
  avatarUrl: text({ length: 600 }),
  settings: text({ length: 10000 }),
  // Stripe customer email; falls back to the acting user's email in ensureStripeCustomer.
  billingEmail: text({ length: 255 }),
  // Our TeamPlanId ("free" | "pro" | ...). Renamed from the old unused `planId` column so the
  // migration treats it as a NEW column: `ALTER TABLE ADD COLUMN ... DEFAULT 'free'` is a valid
  // SQLite primitive (unlike changing an existing column's default, which would force a full
  // table rebuild). getPlan()/entitlements still coalesce null -> "free" defensively.
  subscriptionPlanId: text({ length: 100 }).default("free"),
  // Subscription current period end (item-level current_period_end from Stripe).
  planExpiresAt: integer({ mode: "timestamp" }),
  stripeCustomerId: text({ length: 255 }),
  // Doubles as the team's single checkout slot: createSubscriptionAction claims it
  // atomically (WHERE NULL) so concurrent subscribes converge on one subscription.
  stripeSubscriptionId: text({ length: 255 }),
  // Stripe subscription status (active, trialing, past_due, canceled, incomplete,
  // incomplete_expired, unpaid, paused) or null.
  subscriptionStatus: text({ length: 50 }),
  // Billing interval of the current subscription ("month" | "year"), mirrored from the
  // Stripe price so the billing UI can tell yearly from monthly without a Stripe call.
  subscriptionInterval: text({ length: 10 }),
  // Mirrors Stripe's cancel_at_period_end (0/1) so billing reads stay DB-only.
  cancelAtPeriodEnd: integer().default(0).notNull(),
  // Set the first time a subscription reaches `trialing`; a team gets one free trial ever.
  trialUsedAt: integer({ mode: "timestamp" }),
}, (table) => ([
  index('team_slug_idx').on(table.slug),
  uniqueIndex('team_slug_unique').on(table.slug),
  uniqueIndex('team_stripe_customer_id_unique').on(table.stripeCustomerId),
  uniqueIndex('team_stripe_subscription_id_unique').on(table.stripeSubscriptionId),
]));

// Team membership table
export const teamMembershipTable = sqliteTable("team_membership", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `tmem_${createId()}`).notNull(),
  teamId: text().notNull().references(() => teamTable.id),
  userId: text().notNull().references(() => userTable.id),
  roleId: text().notNull(),
  isSystemRole: integer().default(1).notNull(),
  invitedBy: text().references(() => userTable.id),
  invitedAt: integer({ mode: "timestamp" }),
  joinedAt: integer({ mode: "timestamp" }),
  expiresAt: integer({ mode: "timestamp" }),
  isActive: integer().default(1).notNull(),
}, (table) => ([
  index('team_membership_team_id_idx').on(table.teamId),
  index('team_membership_user_id_idx').on(table.userId),
  // Instead of unique() which causes linter errors, we'll create a unique constraint on columns
  index('team_membership_unique_idx').on(table.teamId, table.userId),
]));

// Team role table
export const teamRoleTable = sqliteTable("team_role", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `trole_${createId()}`).notNull(),
  teamId: text().notNull().references(() => teamTable.id),
  name: text({ length: 255 }).notNull(),
  description: text({ length: 1000 }),
  permissions: text({ mode: 'json' }).notNull().$type<string[]>(),
  metadata: text({ length: 5000 }),
  isEditable: integer().default(1).notNull(),
}, (table) => ([
  index('team_role_team_id_idx').on(table.teamId),
  // Instead of unique() which causes linter errors, we'll create a unique constraint on columns
  index('team_role_name_unique_idx').on(table.teamId, table.name),
]));

// Team invitation table
export const teamInvitationTable = sqliteTable("team_invitation", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `tinv_${createId()}`).notNull(),
  teamId: text().notNull().references(() => teamTable.id),
  email: text({ length: 255 }).notNull(),
  roleId: text().notNull(),
  isSystemRole: integer().default(1).notNull(),
  token: text({ length: 255 }).notNull(),
  invitedBy: text().notNull().references(() => userTable.id),
  expiresAt: integer({ mode: "timestamp" }).notNull(),
  acceptedAt: integer({ mode: "timestamp" }),
  acceptedBy: text().references(() => userTable.id),
}, (table) => ([
  index('team_invitation_team_id_idx').on(table.teamId),
  index('team_invitation_email_idx').on(table.email),
  index('team_invitation_token_idx').on(table.token),
  uniqueIndex('team_invitation_token_unique').on(table.token),
]));

export const cmsMediaTable = sqliteTable("cms_media", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `cms_mda_${createId()}`).notNull(),
  fileName: text().notNull(),
  mimeType: text().notNull(),
  sizeInBytes: integer().notNull(),
  bucketKey: text().notNull(),
  width: integer(),
  height: integer(),
  alt: text(),
  uploadedBy: text().notNull().references(() => userTable.id),
}, (table) => ([
  // Index for filtering by mime type (e.g., get all images, videos, etc.)
  index('cms_media_mime_type_idx').on(table.mimeType),
  // Index for sorting by creation date (most recent uploads)
  index('cms_media_created_at_idx').on(table.createdAt),
  // Index for finding all media uploaded by a user
  index('cms_media_uploaded_by_idx').on(table.uploadedBy),
  uniqueIndex('cms_media_bucketKey_unique').on(table.bucketKey),
]));

const cmsEntryCommonColumns = {
  title: text().notNull(),
  content: text({ mode: 'json' }).$type<JSONContent>().notNull(),
  fields: text({ mode: 'json' }).default('{}').notNull(),
  slug: text().notNull(),
  seoDescription: text(),
  status: text({
    enum: cmsEntryStatusTuple,
  }).notNull().$type<CmsEntryStatus>().notNull(),
  publishedAt: integer({ mode: 'timestamp' }),
  featuredImageId: text().references(() => cmsMediaTable.id, { onDelete: 'set null' }),
  createdBy: text().notNull().references(() => userTable.id),
};

export const cmsEntryTable = sqliteTable("cms_entry", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `cms_ent_${createId()}`).notNull(),
  collection: text().$type<CollectionsUnion>().notNull(),
  ...cmsEntryCommonColumns,
  status: text({
    enum: cmsEntryStatusTuple,
  }).default(CMS_ENTRY_STATUS.DRAFT).$type<CmsEntryStatus>().notNull(), // Override status to add default
  // Language of this entry. Translations of one logical entry share (collection, slug)
  // and differ by locale. Default 'en' keeps existing rows valid and inert.
  locale: text().notNull().default(DEFAULT_LOCALE),
  // Snapshot of the canonical (default-locale) source's per-field content hashes, captured when this
  // translation was created or last refreshed. Compared against the source's live hashes to flag stale
  // translations in the editor. Null on the source row itself and on legacy/pre-feature rows (treated as "not stale").
  sourceContentHashes: text({ mode: "json" }).$type<SourceContentHashes | null>(),
}, (table) => ([
  // Index for filtering by collection (most common query)
  index('cms_entry_collection_idx').on(table.collection),

  // Index for filtering by status (published vs draft vs archived)
  index('cms_entry_status_idx').on(table.status),

  // Composite index for collection + status (very common: "get all published posts")
  index('cms_entry_collection_status_idx').on(table.collection, table.status),

  // Index for slug lookups (finding specific entries by slug)
  index('cms_entry_slug_idx').on(table.slug),

  // Was (collection, slug); now scoped by locale so each language has its own row.
  uniqueIndex('cms_entry_collection_slug_locale_unique').on(table.collection, table.slug, table.locale),

  // Listing queries: published entries for a collection in a locale.
  index('cms_entry_collection_locale_status_idx').on(table.collection, table.locale, table.status),

  // Index for created by (finding entries by author)
  index('cms_entry_created_by_idx').on(table.createdBy),

  // Composite index for author + status (e.g., "my drafts")
  index('cms_entry_created_by_status_idx').on(table.createdBy, table.status),

  // Index for sorting by creation date (most recent entries)
  index('cms_entry_created_at_idx').on(table.createdAt),

  // Composite index for collection + status + created date (optimized listing with filters and sorting)
  index('cms_entry_collection_status_created_at_idx').on(table.collection, table.status, table.createdAt),

  // Composite index for collection + created date (optimized listing for admin dashboard)
  index('cms_entry_collection_created_at_idx').on(table.collection, table.createdAt),

  // Index for featured image lookups
  index('cms_entry_featured_image_idx').on(table.featuredImageId),
]));

export const scheduledJobTable = sqliteTable("scheduled_job", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `sjob_${createId()}`).notNull(),
  type: text().$type<ScheduledJobType>().notNull(),
  dedupeKey: text().notNull(),
  payload: text({ mode: "json" }).$type<ScheduledJobPayload>().notNull(),
  runAt: integer({ mode: "timestamp" }).notNull(),
}, (table) => ([
  index("scheduled_job_run_at_idx").on(table.runAt),
  uniqueIndex("scheduled_job_type_dedupe_key_unique").on(table.type, table.dedupeKey),
]));

export const cmsNavigationItemTable = sqliteTable("cms_navigation_item", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `cms_nav_${createId()}`).notNull(),
  navigationKey: text({
    enum: cmsNavigationKeys,
  }).$type<CmsNavigationKey>().notNull(),
  parentId: text(),
  nodeType: text({
    enum: cmsNavigationNodeTypeTuple,
  }).$type<CmsNavigationNodeType>().notNull(),
  title: text().notNull(),
  // Per-locale overrides for `title`, keyed by locale (e.g. { es: "Documentación" }).
  // GROUP/header nodes have no linked entry to borrow a translated title from, so
  // the public tree overlays this for non-default locales; null = untranslated.
  titleTranslations: text({ mode: "json" }).$type<Partial<Record<Locale, string>>>(),
  entryId: text().references(() => cmsEntryTable.id, { onDelete: "cascade" }),
  slugSegment: text(),
  resolvedPath: text(),
  sortOrder: integer().default(0).notNull(),
}, (table) => ([
  index("cms_navigation_item_site_key_idx").on(table.navigationKey),
  index("cms_navigation_item_parent_id_idx").on(table.parentId),
  uniqueIndex("cms_navigation_item_site_path_unique").on(table.navigationKey, table.resolvedPath),
  uniqueIndex("cms_navigation_item_site_parent_sort_order_unique").on(table.navigationKey, table.parentId, table.sortOrder),
  uniqueIndex("cms_navigation_item_site_entry_unique").on(table.navigationKey, table.entryId),
]));

export const cmsNavigationRedirectTable = sqliteTable("cms_navigation_redirect", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `cms_red_${createId()}`).notNull(),
  navigationKey: text({
    enum: cmsNavigationKeys,
  }).$type<CmsNavigationKey>().notNull(),
  fromPath: text().notNull(),
  toPath: text().notNull(),
  statusCode: integer().default(307).notNull(),
}, (table) => ([
  index("cms_navigation_redirect_site_key_idx").on(table.navigationKey),
  uniqueIndex("cms_navigation_redirect_site_from_path_unique").on(table.navigationKey, table.fromPath),
]));

export const cmsEntryVersionTable = sqliteTable("cms_entry_version", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `cms_ver_${createId()}`).notNull(),
  entryId: text().notNull().references(() => cmsEntryTable.id, { onDelete: 'cascade' }),
  versionNumber: integer().notNull(),
  ...cmsEntryCommonColumns,
}, (table) => ([
  index('cms_entry_version_entry_id_idx').on(table.entryId),
  index('cms_entry_version_entry_id_version_idx').on(table.entryId, table.versionNumber),
]));

// Junction table for many-to-many relationship between entries and media
export const cmsEntryMediaTable = sqliteTable("cms_entry_media", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `cms_em_${createId()}`).notNull(),
  entryId: text().notNull().references(() => cmsEntryTable.id, { onDelete: 'cascade' }),
  mediaId: text().notNull().references(() => cmsMediaTable.id, { onDelete: 'cascade' }),
  position: integer(),
  caption: text(),
}, (table) => ([
  // Index for finding all media in an entry
  index('cms_entry_media_entry_id_idx').on(table.entryId),
  // Index for finding all entries using a media item
  index('cms_entry_media_media_id_idx').on(table.mediaId),
  // Unique index to prevent the same media from being attached to the same entry multiple times
  uniqueIndex('cms_entry_media_entry_media_unique').on(table.entryId, table.mediaId),
]));

export const cmsTagTable = sqliteTable("cms_tag", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `ctag_${createId()}`).notNull(),
  name: text().notNull(),
  slug: text().notNull(),
  description: text(),
  color: text(),
  // Language of this tag. Translations of one logical tag share `slug` and differ
  // by locale (mirrors cmsEntryTable). Default 'en' keeps existing rows valid.
  locale: text().notNull().default(DEFAULT_LOCALE),
  createdBy: text().notNull().references(() => userTable.id),
}, (table) => ([
  // Was global (name)/(slug); now scoped by locale so each language has its own row.
  uniqueIndex('cms_tag_name_locale_unique').on(table.name, table.locale),
  uniqueIndex('cms_tag_slug_locale_unique').on(table.slug, table.locale),
  // `slug` groups the translation siblings; index it for group lookups.
  index('cms_tag_slug_idx').on(table.slug),
]));

// Junction table for many-to-many relationship between entries and tags
export const cmsEntryTagTable = sqliteTable("cms_entry_tag", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `cet_${createId()}`).notNull(),
  entryId: text().notNull().references(() => cmsEntryTable.id, { onDelete: 'cascade' }),
  tagId: text().notNull().references(() => cmsTagTable.id, { onDelete: 'cascade' }),
}, (table) => ([
  index('cms_entry_tag_entry_id_idx').on(table.entryId),
  index('cms_entry_tag_tag_id_idx').on(table.tagId),
  uniqueIndex('cms_entry_tag_unique').on(table.entryId, table.tagId),
]));

const relationSchema = {
  cmsNavigationItemTable,
  cmsNavigationRedirectTable,
  cmsEntryMediaTable,
  cmsEntryTable,
  cmsEntryTagTable,
  cmsEntryVersionTable,
  cmsMediaTable,
  cmsTagTable,
  passKeyCredentialTable,
  scheduledJobTable,
  teamInvitationTable,
  teamMembershipTable,
  teamRoleTable,
  teamTable,
  userTable,
};

export const relations = defineRelations(relationSchema, (r) => ({
  cmsMediaTable: {
    entryMedia: r.many.cmsEntryMediaTable({
      from: r.cmsMediaTable.id,
      to: r.cmsEntryMediaTable.mediaId,
    }),
    uploadedByUser: r.one.userTable({
      from: r.cmsMediaTable.uploadedBy,
      to: r.userTable.id,
      optional: false,
    }),
  },
  cmsEntryMediaTable: {
    entry: r.one.cmsEntryTable({
      from: r.cmsEntryMediaTable.entryId,
      to: r.cmsEntryTable.id,
      optional: false,
    }),
    media: r.one.cmsMediaTable({
      from: r.cmsEntryMediaTable.mediaId,
      to: r.cmsMediaTable.id,
      optional: false,
    }),
  },
  cmsTagTable: {
    entries: r.many.cmsEntryTagTable({
      from: r.cmsTagTable.id,
      to: r.cmsEntryTagTable.tagId,
    }),
    createdByUser: r.one.userTable({
      from: r.cmsTagTable.createdBy,
      to: r.userTable.id,
      optional: false,
    }),
  },
  cmsEntryTagTable: {
    entry: r.one.cmsEntryTable({
      from: r.cmsEntryTagTable.entryId,
      to: r.cmsEntryTable.id,
      optional: false,
    }),
    tag: r.one.cmsTagTable({
      from: r.cmsEntryTagTable.tagId,
      to: r.cmsTagTable.id,
      optional: false,
    }),
  },
  cmsEntryTable: {
    createdByUser: r.one.userTable({
      from: r.cmsEntryTable.createdBy,
      to: r.userTable.id,
      optional: false,
    }),
    featuredImage: r.one.cmsMediaTable({
      from: r.cmsEntryTable.featuredImageId,
      to: r.cmsMediaTable.id,
    }),
    entryMedia: r.many.cmsEntryMediaTable({
      from: r.cmsEntryTable.id,
      to: r.cmsEntryMediaTable.entryId,
    }),
    tags: r.many.cmsEntryTagTable({
      from: r.cmsEntryTable.id,
      to: r.cmsEntryTagTable.entryId,
    }),
    versions: r.many.cmsEntryVersionTable({
      from: r.cmsEntryTable.id,
      to: r.cmsEntryVersionTable.entryId,
    }),
  },
  cmsEntryVersionTable: {
    entry: r.one.cmsEntryTable({
      from: r.cmsEntryVersionTable.entryId,
      to: r.cmsEntryTable.id,
      optional: false,
    }),
    createdByUser: r.one.userTable({
      from: r.cmsEntryVersionTable.createdBy,
      to: r.userTable.id,
      optional: false,
    }),
    featuredImage: r.one.cmsMediaTable({
      from: r.cmsEntryVersionTable.featuredImageId,
      to: r.cmsMediaTable.id,
    }),
  },
  teamTable: {
    memberships: r.many.teamMembershipTable({
      from: r.teamTable.id,
      to: r.teamMembershipTable.teamId,
    }),
    invitations: r.many.teamInvitationTable({
      from: r.teamTable.id,
      to: r.teamInvitationTable.teamId,
    }),
    roles: r.many.teamRoleTable({
      from: r.teamTable.id,
      to: r.teamRoleTable.teamId,
    }),
  },
  teamRoleTable: {
    team: r.one.teamTable({
      from: r.teamRoleTable.teamId,
      to: r.teamTable.id,
      optional: false,
    }),
  },
  teamMembershipTable: {
    team: r.one.teamTable({
      from: r.teamMembershipTable.teamId,
      to: r.teamTable.id,
      optional: false,
    }),
    user: r.one.userTable({
      from: r.teamMembershipTable.userId,
      to: r.userTable.id,
      optional: false,
    }),
    invitedByUser: r.one.userTable({
      from: r.teamMembershipTable.invitedBy,
      to: r.userTable.id,
    }),
  },
  teamInvitationTable: {
    team: r.one.teamTable({
      from: r.teamInvitationTable.teamId,
      to: r.teamTable.id,
      optional: false,
    }),
    invitedByUser: r.one.userTable({
      from: r.teamInvitationTable.invitedBy,
      to: r.userTable.id,
      optional: false,
    }),
    acceptedByUser: r.one.userTable({
      from: r.teamInvitationTable.acceptedBy,
      to: r.userTable.id,
    }),
  },
  userTable: {
    passkeys: r.many.passKeyCredentialTable({
      from: r.userTable.id,
      to: r.passKeyCredentialTable.userId,
    }),
    teamMemberships: r.many.teamMembershipTable({
      from: r.userTable.id,
      to: r.teamMembershipTable.userId,
    }),
    cmsEntries: r.many.cmsEntryTable({
      from: r.userTable.id,
      to: r.cmsEntryTable.createdBy,
    }),
    cmsMedia: r.many.cmsMediaTable({
      from: r.userTable.id,
      to: r.cmsMediaTable.uploadedBy,
    }),
    cmsTags: r.many.cmsTagTable({
      from: r.userTable.id,
      to: r.cmsTagTable.createdBy,
    }),
  },
  passKeyCredentialTable: {
    user: r.one.userTable({
      from: r.passKeyCredentialTable.userId,
      to: r.userTable.id,
      optional: false,
    }),
  },
}));

// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type User = InferSelectModel<typeof userTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type PassKeyCredential = InferSelectModel<typeof passKeyCredentialTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type Team = InferSelectModel<typeof teamTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type TeamMembership = InferSelectModel<typeof teamMembershipTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type TeamRole = InferSelectModel<typeof teamRoleTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type TeamInvitation = InferSelectModel<typeof teamInvitationTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type CmsEntry = InferSelectModel<typeof cmsEntryTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type CmsMedia = InferSelectModel<typeof cmsMediaTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type CmsEntryMedia = InferSelectModel<typeof cmsEntryMediaTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type CmsTag = InferSelectModel<typeof cmsTagTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type CmsEntryTag = InferSelectModel<typeof cmsEntryTagTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type CmsEntryVersion = InferSelectModel<typeof cmsEntryVersionTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type CmsNavigationItem = InferSelectModel<typeof cmsNavigationItemTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type CmsNavigationRedirect = InferSelectModel<typeof cmsNavigationRedirectTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type ScheduledJob = InferSelectModel<typeof scheduledJobTable>;
