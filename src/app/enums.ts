export const CMS_ENTRY_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  SCHEDULED: 'scheduled',
  ARCHIVED: 'archived',
} as const;

export const ROLES_ENUM = {
  ADMIN: 'admin',
  USER: 'user',
} as const;

export type UserRole = (typeof ROLES_ENUM)[keyof typeof ROLES_ENUM];
