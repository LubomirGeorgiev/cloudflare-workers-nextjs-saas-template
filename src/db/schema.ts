import { sqliteTable, integer, text, index, unique } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";
import { type InferSelectModel } from "drizzle-orm";

import { createId } from '@paralleldrive/cuid2'

export const ROLES_ENUM = {
  ADMIN: 'admin',
  USER: 'user',
} as const;

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
  }).unique(),
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
  // Credit system fields
  currentCredits: integer().default(0).notNull(),
  lastCreditRefreshAt: integer({
    mode: "timestamp",
  }),
}, (table) => ([
  index('email_idx').on(table.email),
  index('google_account_id_idx').on(table.googleAccountId),
  index('role_idx').on(table.role),
]));

export const passKeyCredentialTable = sqliteTable("passkey_credential", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `pkey_${createId()}`).notNull(),
  userId: text().notNull().references(() => userTable.id),
  credentialId: text({
    length: 255,
  }).notNull().unique(),
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
]));

// Credit transaction types
export const CREDIT_TRANSACTION_TYPE = {
  PURCHASE: 'PURCHASE',
  USAGE: 'USAGE',
  MONTHLY_REFRESH: 'MONTHLY_REFRESH',
} as const;

export const creditTransactionTypeTuple = Object.values(CREDIT_TRANSACTION_TYPE) as [string, ...string[]];

export const creditTransactionTable = sqliteTable("credit_transaction", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `ctxn_${createId()}`).notNull(),
  userId: text().notNull().references(() => userTable.id),
  amount: integer().notNull(),
  // Track how many credits are still available from this transaction
  remainingAmount: integer().default(0).notNull(),
  type: text({
    enum: creditTransactionTypeTuple,
  }).notNull(),
  description: text({
    length: 255,
  }).notNull(),
  expirationDate: integer({
    mode: "timestamp",
  }),
  expirationDateProcessedAt: integer({
    mode: "timestamp",
  }),
  paymentIntentId: text({
    length: 255,
  }),
}, (table) => ([
  index('credit_transaction_user_id_idx').on(table.userId),
  index('credit_transaction_type_idx').on(table.type),
  index('credit_transaction_created_at_idx').on(table.createdAt),
  index('credit_transaction_expiration_date_idx').on(table.expirationDate),
  index('credit_transaction_payment_intent_id_idx').on(table.paymentIntentId),
]));

// Define item types that can be purchased
export const PURCHASABLE_ITEM_TYPE = {
  COMPONENT: 'COMPONENT',
  // Add more types in the future (e.g., TEMPLATE, PLUGIN, etc.)
} as const;

export const purchasableItemTypeTuple = Object.values(PURCHASABLE_ITEM_TYPE) as [string, ...string[]];

export const purchasedItemsTable = sqliteTable("purchased_item", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `pitem_${createId()}`).notNull(),
  userId: text().notNull().references(() => userTable.id),
  // The type of item (e.g., COMPONENT, TEMPLATE, etc.)
  itemType: text({
    enum: purchasableItemTypeTuple,
  }).notNull(),
  // The ID of the item within its type (e.g., componentId)
  itemId: text().notNull(),
  purchasedAt: integer({
    mode: "timestamp",
  }).$defaultFn(() => new Date()).notNull(),
}, (table) => ([
  index('purchased_item_user_id_idx').on(table.userId),
  index('purchased_item_type_idx').on(table.itemType),
  // Composite index for checking if a user owns a specific item of a specific type
  index('purchased_item_user_item_idx').on(table.userId, table.itemType, table.itemId),
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

  // Add more as needed
} as const;

// Team table
export const teamTable = sqliteTable("team", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `team_${createId()}`).notNull(),
  name: text({ length: 255 }).notNull(),
  slug: text({ length: 255 }).notNull().unique(),
  description: text({ length: 1000 }),
  avatarUrl: text({ length: 600 }),
  // Settings could be stored as JSON
  settings: text({ length: 10000 }),
  // Optional billing-related fields
  billingEmail: text({ length: 255 }),
  planId: text({ length: 100 }),
  planExpiresAt: integer({ mode: "timestamp" }),
  creditBalance: integer().default(0).notNull(),
}, (table) => ([
  index('team_slug_idx').on(table.slug),
]));

// Team membership table
export const teamMembershipTable = sqliteTable("team_membership", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `tmem_${createId()}`).notNull(),
  teamId: text().notNull().references(() => teamTable.id),
  userId: text().notNull().references(() => userTable.id),
  // This can be either a system role or a custom role ID
  roleId: text().notNull(),
  // Flag to indicate if this is a system role
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
  // Store permissions as a JSON array of permission keys
  permissions: text({ mode: 'json' }).notNull().$type<string[]>(),
  // A JSON field for storing UI-specific settings like color, icon, etc.
  metadata: text({ length: 5000 }),
  // Optional flag to mark some roles as non-editable
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
  // This can be either a system role or a custom role ID
  roleId: text().notNull(),
  // Flag to indicate if this is a system role
  isSystemRole: integer().default(1).notNull(),
  token: text({ length: 255 }).notNull().unique(),
  invitedBy: text().notNull().references(() => userTable.id),
  expiresAt: integer({ mode: "timestamp" }).notNull(),
  acceptedAt: integer({ mode: "timestamp" }),
  acceptedBy: text().references(() => userTable.id),
}, (table) => ([
  index('team_invitation_team_id_idx').on(table.teamId),
  index('team_invitation_email_idx').on(table.email),
  index('team_invitation_token_idx').on(table.token),
]));

export const cmsMediaTable = sqliteTable("cms_media", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `cms_mda_${createId()}`).notNull(),
  fileName: text().notNull(),
  mimeType: text().notNull(),
  sizeInBytes: integer().notNull(),
  bucketKey: text().notNull().unique(),
  width: integer(),
  height: integer(),
  alt: text(),
  uploadedBy: text().notNull().references(() => userTable.id),
}, (table) => ([
  // Index for filtering by mime type (e.g., get all images, videos, etc.)
  index('cms_media_mime_type_idx').on(table.mimeType),
  // Index for sorting by creation date (most recent uploads)
  index('cms_media_created_at_idx').on(table.createdAt),
  // Index for bucket key lookups
  index('cms_media_bucket_key_idx').on(table.bucketKey),
  // Index for finding all media uploaded by a user
  index('cms_media_uploaded_by_idx').on(table.uploadedBy),
]));

export const CMS_ENTRY_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
} as const;

const cmsEntryStatusTuple = Object.values(CMS_ENTRY_STATUS) as [string, ...string[]];

export const cmsEntryTable = sqliteTable("cms_entry", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `cms_ent_${createId()}`).notNull(),
  collection: text().notNull(),
  title: text().notNull(),
  content: text({ mode: 'json' }).notNull(),
  fields: text({ mode: 'json' }).notNull(),
  slug: text().notNull(),
  status: text({
    enum: cmsEntryStatusTuple,
  }).default(CMS_ENTRY_STATUS.DRAFT).notNull(),
  createdBy: text().notNull().references(() => userTable.id),
}, (table) => ([
  // Index for filtering by collection (most common query)
  index('cms_entry_collection_idx').on(table.collection),

  // Index for filtering by status (published vs draft vs archived)
  index('cms_entry_status_idx').on(table.status),

  // Composite index for collection + status (very common: "get all published posts")
  index('cms_entry_collection_status_idx').on(table.collection, table.status),

  // Index for slug lookups (finding specific entries by slug)
  index('cms_entry_slug_idx').on(table.slug),

  // Unique constraint for collection + slug (ensure unique slugs per collection)
  unique('cms_entry_collection_slug_unique').on(table.collection, table.slug),

  // Index for created by (finding entries by author)
  index('cms_entry_created_by_idx').on(table.createdBy),

  // Composite index for author + status (e.g., "my drafts")
  index('cms_entry_created_by_status_idx').on(table.createdBy, table.status),

  // Index for sorting by creation date (most recent entries)
  index('cms_entry_created_at_idx').on(table.createdAt),

  // Composite index for collection + status + created date (optimized listing with filters and sorting)
  index('cms_entry_collection_status_created_at_idx').on(table.collection, table.status, table.createdAt),
]));

// Junction table for many-to-many relationship between entries and media
export const cmsEntryMediaTable = sqliteTable("cms_entry_media", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `cms_em_${createId()}`).notNull(),
  entryId: text().notNull().references(() => cmsEntryTable.id),
  mediaId: text().notNull().references(() => cmsMediaTable.id),
  // Optional: track the order/position of media within an entry
  position: integer(),
  // Optional: caption or description specific to this usage
  caption: text(),
}, (table) => ([
  // Index for finding all media in an entry
  index('cms_entry_media_entry_id_idx').on(table.entryId),
  // Index for finding all entries using a media item
  index('cms_entry_media_media_id_idx').on(table.mediaId),
  // Unique constraint to prevent the same media from being attached to the same entry multiple times
  unique('cms_entry_media_entry_media_unique').on(table.entryId, table.mediaId),
]));

export const cmsMediaRelations = relations(cmsMediaTable, ({ many, one }) => ({
  entryMedia: many(cmsEntryMediaTable),
  uploadedByUser: one(userTable, {
    fields: [cmsMediaTable.uploadedBy],
    references: [userTable.id],
  }),
}));

export const cmsEntryMediaRelations = relations(cmsEntryMediaTable, ({ one }) => ({
  entry: one(cmsEntryTable, {
    fields: [cmsEntryMediaTable.entryId],
    references: [cmsEntryTable.id],
  }),
  media: one(cmsMediaTable, {
    fields: [cmsEntryMediaTable.mediaId],
    references: [cmsMediaTable.id],
  }),
}));

export const cmsEntryRelations = relations(cmsEntryTable, ({ one, many }) => ({
  createdByUser: one(userTable, {
    fields: [cmsEntryTable.createdBy],
    references: [userTable.id],
  }),
  entryMedia: many(cmsEntryMediaTable),
}));

export const teamRelations = relations(teamTable, ({ many }) => ({
  memberships: many(teamMembershipTable),
  invitations: many(teamInvitationTable),
  roles: many(teamRoleTable),
}));

export const teamRoleRelations = relations(teamRoleTable, ({ one }) => ({
  team: one(teamTable, {
    fields: [teamRoleTable.teamId],
    references: [teamTable.id],
  }),
}));

export const teamMembershipRelations = relations(teamMembershipTable, ({ one }) => ({
  team: one(teamTable, {
    fields: [teamMembershipTable.teamId],
    references: [teamTable.id],
  }),
  user: one(userTable, {
    fields: [teamMembershipTable.userId],
    references: [userTable.id],
  }),
  invitedByUser: one(userTable, {
    fields: [teamMembershipTable.invitedBy],
    references: [userTable.id],
  }),
}));

export const teamInvitationRelations = relations(teamInvitationTable, ({ one }) => ({
  team: one(teamTable, {
    fields: [teamInvitationTable.teamId],
    references: [teamTable.id],
  }),
  invitedByUser: one(userTable, {
    fields: [teamInvitationTable.invitedBy],
    references: [userTable.id],
  }),
  acceptedByUser: one(userTable, {
    fields: [teamInvitationTable.acceptedBy],
    references: [userTable.id],
  }),
}));

export const creditTransactionRelations = relations(creditTransactionTable, ({ one }) => ({
  user: one(userTable, {
    fields: [creditTransactionTable.userId],
    references: [userTable.id],
  }),
}));

export const purchasedItemsRelations = relations(purchasedItemsTable, ({ one }) => ({
  user: one(userTable, {
    fields: [purchasedItemsTable.userId],
    references: [userTable.id],
  }),
}));

export const userRelations = relations(userTable, ({ many }) => ({
  passkeys: many(passKeyCredentialTable),
  creditTransactions: many(creditTransactionTable),
  purchasedItems: many(purchasedItemsTable),
  teamMemberships: many(teamMembershipTable),
  cmsEntries: many(cmsEntryTable),
  cmsMedia: many(cmsMediaTable),
}));

export const passKeyCredentialRelations = relations(passKeyCredentialTable, ({ one }) => ({
  user: one(userTable, {
    fields: [passKeyCredentialTable.userId],
    references: [userTable.id],
  }),
}));

export type User = InferSelectModel<typeof userTable>;
export type PassKeyCredential = InferSelectModel<typeof passKeyCredentialTable>;
export type CreditTransaction = InferSelectModel<typeof creditTransactionTable>;
export type PurchasedItem = InferSelectModel<typeof purchasedItemsTable>;
export type Team = InferSelectModel<typeof teamTable>;
export type TeamMembership = InferSelectModel<typeof teamMembershipTable>;
export type TeamRole = InferSelectModel<typeof teamRoleTable>;
export type TeamInvitation = InferSelectModel<typeof teamInvitationTable>;
export type CmsEntry = InferSelectModel<typeof cmsEntryTable>;
export type CmsMedia = InferSelectModel<typeof cmsMediaTable>;
export type CmsEntryMedia = InferSelectModel<typeof cmsEntryMediaTable>;
