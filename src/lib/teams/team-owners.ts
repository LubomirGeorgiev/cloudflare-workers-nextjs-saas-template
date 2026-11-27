import "server-only";

import { and, eq } from "drizzle-orm";

import { SYSTEM_ROLES_ENUM } from "@/constants/team-roles";
import { getDB } from "@/db";
import { teamMembershipTable, userTable } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { isMembershipCurrentlyActive } from "@/utils/team-membership";

/** One owner of a team, with what an app email to that owner needs. */
interface TeamOwnerRecipient {
  email: string;
  username: string;
  locale: Locale | null;
}

/** Every active owner of a team. Team billing emails go to all of them, not to one. */
export async function listTeamOwnerRecipients({ teamId }: { teamId: string }): Promise<TeamOwnerRecipient[]> {
  const rows = await getDB()
    .select({
      email: userTable.email,
      firstName: userTable.firstName,
      preferredLocale: userTable.preferredLocale,
      isActive: teamMembershipTable.isActive,
      expiresAt: teamMembershipTable.expiresAt,
    })
    .from(teamMembershipTable)
    .innerJoin(userTable, eq(userTable.id, teamMembershipTable.userId))
    .where(and(
      eq(teamMembershipTable.teamId, teamId),
      eq(teamMembershipTable.roleId, SYSTEM_ROLES_ENUM.OWNER),
      eq(teamMembershipTable.isSystemRole, 1),
    ));

  return selectTeamOwnerRecipients(rows);
}

// `isMembershipCurrentlyActive` is the one liveness rule, so an expired owner gets no email.
export function selectTeamOwnerRecipients(rows: TeamOwnerRow[]): TeamOwnerRecipient[] {
  return rows.flatMap((row) => (row.email && isMembershipCurrentlyActive(row)
    ? [{ email: row.email, username: row.firstName?.trim() || row.email, locale: row.preferredLocale ?? null }]
    : []));
}

interface TeamOwnerRow {
  email: string | null;
  firstName: string | null;
  preferredLocale: Locale | null;
  isActive: boolean | number;
  expiresAt: Date | null;
}
