// Import-free on purpose: client components render role labels, and a Drizzle import here would
// pull the whole schema into every client chunk that reads a role. The one import site for every
// consumer, server or client — `src/db/schema.ts` no longer re-exports these.

// System-defined roles - these are always available
export const SYSTEM_ROLES_ENUM = {
  OWNER: 'owner',
  MEMBER: 'member',
  GUEST: 'guest',
} as const;

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

  // Machine credentials
  MANAGE_API_KEYS: 'manage_api_keys',
} as const;

export type SystemRole = typeof SYSTEM_ROLES_ENUM[keyof typeof SYSTEM_ROLES_ENUM];
type TeamPermission = typeof TEAM_PERMISSIONS[keyof typeof TEAM_PERMISSIONS];

export const SYSTEM_ROLE_PERMISSIONS = {
  [SYSTEM_ROLES_ENUM.OWNER]: Object.values(TEAM_PERMISSIONS),
  [SYSTEM_ROLES_ENUM.MEMBER]: [
    TEAM_PERMISSIONS.ACCESS_DASHBOARD,
  ],
  [SYSTEM_ROLES_ENUM.GUEST]: [
    TEAM_PERMISSIONS.ACCESS_DASHBOARD,
  ],
} satisfies Record<SystemRole, readonly TeamPermission[]>;
