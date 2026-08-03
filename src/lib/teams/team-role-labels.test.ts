import { describe, expect, it } from "vitest";

import { SYSTEM_ROLES_ENUM } from "@/db/schema";
import { formatTeamRoleLabel } from "@/lib/teams/team-role-labels";

// Stands in for the `Client.Dashboard.Teams` namespace: the key itself is the assertion, so the
// test stays valid in a fork that rewrites the copy.
function translate(key: string): string {
  return `translated:${key}`;
}

describe("formatTeamRoleLabel", () => {
  it("translates every system role", () => {
    for (const roleId of Object.values(SYSTEM_ROLES_ENUM)) {
      expect(
        formatTeamRoleLabel({
          member: { roleId, isSystemRole: true, roleName: null },
          translate,
        }),
      ).toBe(`translated:role${roleId[0].toUpperCase()}${roleId.slice(1)}`);
    }
  });

  it("falls back to the raw id for an unrecognized system role", () => {
    expect(
      formatTeamRoleLabel({
        member: { roleId: "retired-role", isSystemRole: true, roleName: null },
        translate,
      }),
    ).toBe("retired-role");
  });

  it("uses the stored name of a custom role", () => {
    expect(
      formatTeamRoleLabel({
        member: { roleId: "trole_1", isSystemRole: false, roleName: "Billing" },
        translate,
      }),
    ).toBe("Billing");
  });

  // A custom roleId that resolved to nothing (deleted role, or one belonging to another team)
  // still has to render as something.
  it("falls back to the generic custom label when the name is missing", () => {
    expect(
      formatTeamRoleLabel({
        member: { roleId: "trole_1", isSystemRole: false, roleName: null },
        translate,
      }),
    ).toBe("translated:roleCustom");
  });
});
