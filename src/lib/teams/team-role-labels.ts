import { SYSTEM_ROLES_ENUM, type SystemRole } from "@/db/schema";

// A table, not a ladder: a system role added to the enum without a label here is a compile error.
const SYSTEM_ROLE_LABEL_KEY = {
  [SYSTEM_ROLES_ENUM.OWNER]: "roleOwner",
  [SYSTEM_ROLES_ENUM.MEMBER]: "roleMember",
  [SYSTEM_ROLES_ENUM.GUEST]: "roleGuest",
} as const satisfies Record<SystemRole, string>;

type TeamRoleLabelKey = (typeof SYSTEM_ROLE_LABEL_KEY)[SystemRole] | "roleCustom";

interface TeamRoleLabelMembership {
  roleId: string;
  isSystemRole: boolean;
  /** The stored name of a custom role; null for system roles and for cross-team role ids. */
  roleName: string | null;
}

/**
 * The one place a membership turns into display copy, shared by the team dashboard and the admin
 * user detail page. `translate` is `Client.Dashboard.Teams`, from either the server or client hook.
 * An unrecognized system role falls back to its raw id rather than an empty cell.
 */
export function formatTeamRoleLabel({
  member,
  translate,
}: {
  member: TeamRoleLabelMembership;
  translate: (key: TeamRoleLabelKey) => string;
}): string {
  if (!member.isSystemRole) {
    return member.roleName ?? translate("roleCustom");
  }

  const labelKey = Object.hasOwn(SYSTEM_ROLE_LABEL_KEY, member.roleId)
    ? SYSTEM_ROLE_LABEL_KEY[member.roleId as SystemRole]
    : null;

  return labelKey ? translate(labelKey) : member.roleId;
}
