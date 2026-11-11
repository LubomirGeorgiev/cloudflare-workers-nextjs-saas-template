import { describe, expect, test } from "vitest";

import { isTeamOwnerRole, SYSTEM_ROLES_ENUM } from "@/constants/team-roles";

describe("isTeamOwnerRole", () => {
  test("accepts the system owner role in boolean and D1 integer form", () => {
    expect(isTeamOwnerRole({ roleId: SYSTEM_ROLES_ENUM.OWNER, isSystemRole: true })).toBe(true);
    expect(isTeamOwnerRole({ roleId: SYSTEM_ROLES_ENUM.OWNER, isSystemRole: 1 })).toBe(true);
  });

  test("refuses a custom role with the owner id and every other system role", () => {
    expect(isTeamOwnerRole({ roleId: SYSTEM_ROLES_ENUM.OWNER, isSystemRole: false })).toBe(false);
    expect(isTeamOwnerRole({ roleId: SYSTEM_ROLES_ENUM.OWNER, isSystemRole: 0 })).toBe(false);

    for (const roleId of Object.values(SYSTEM_ROLES_ENUM).filter((id) => id !== SYSTEM_ROLES_ENUM.OWNER)) {
      expect(isTeamOwnerRole({ roleId, isSystemRole: true })).toBe(false);
    }
  });
});
