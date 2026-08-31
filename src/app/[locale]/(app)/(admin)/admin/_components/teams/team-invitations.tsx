"use client";

import { MailPlus } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AdminTeamInvitation, AdminTeamSectionList } from "@/lib/admin/teams";
import { formatTeamRoleLabel } from "@/lib/teams/team-role-labels";
import { AdminDetailSection } from "../admin-detail-section";
import { RelativeDateCell } from "../relative-date-cell";

// Read-only on purpose: revoking an invitation is a team-permission operation the team's own
// members already have, and nothing about it needs a staff override.
export function TeamInvitations({
  invitations,
}: {
  invitations: AdminTeamSectionList<AdminTeamInvitation>;
}) {
  const tTeams = useTranslations("Client.Dashboard.Teams");
  const { items, hasMore } = invitations;

  const description = hasMore
    ? `The first ${items.length} invitations that are neither accepted nor expired. This team has more.`
    : "Invitations that are neither accepted nor expired.";

  return (
    <AdminDetailSection
      icon={MailPlus}
      title={`Pending invitations (${items.length}${hasMore ? "+" : ""})`}
      description={description}
      emptyMessage="This team has no pending invitations"
      isEmpty={items.length === 0}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Sent</TableHead>
            <TableHead>Expires</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((invitation) => (
            <TableRow key={invitation.id}>
              <TableCell className="font-medium">{invitation.email}</TableCell>
              <TableCell className="capitalize">
                {formatTeamRoleLabel({ member: invitation, translate: tTeams })}
              </TableCell>
              <TableCell>
                <RelativeDateCell value={invitation.createdAt} />
              </TableCell>
              <TableCell>
                <RelativeDateCell value={invitation.expiresAt} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AdminDetailSection>
  );
}
