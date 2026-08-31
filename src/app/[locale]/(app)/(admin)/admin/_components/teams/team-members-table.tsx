"use client";

import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ADMIN_USERS_PATH } from "@/constants";
import { Link } from "@/i18n/navigation";
import type { AdminTeamMember, AdminTeamSectionList } from "@/lib/admin/teams";
import { formatTeamRoleLabel } from "@/lib/teams/team-role-labels";
import { removeTeamMemberAction } from "../../_actions/team-actions";
import { AdminDetailSection } from "../admin-detail-section";
import { RelativeDateCell } from "../relative-date-cell";
import { RemoveTeamMemberControl } from "../remove-team-member-control";

function TeamMemberRow({
  member,
  teamName,
  roleLabel,
  onRemove,
}: {
  member: AdminTeamMember;
  teamName: string;
  roleLabel: string;
  onRemove: () => Promise<unknown>;
}) {
  return (
    <TableRow>
      <TableCell>
        <Link
          href={`${ADMIN_USERS_PATH}/${member.userId}`}
          className="flex flex-col hover:underline"
        >
          <span className="font-medium">{member.email || member.userId}</span>
          {member.name ? (
            <span className="text-xs text-muted-foreground">{member.name}</span>
          ) : null}
        </Link>
      </TableCell>
      <TableCell className="capitalize">{roleLabel}</TableCell>
      <TableCell>
        <RelativeDateCell value={member.joinedAt} emptyLabel="Not joined" />
      </TableCell>
      <TableCell>
        {member.isActive
          ? <span className="text-green-600 dark:text-green-400">Active</span>
          : <span className="text-red-600 dark:text-red-400">Inactive</span>}
      </TableCell>
      <TableCell className="text-right">
        <RemoveTeamMemberControl
          member={member}
          removeLabel="Remove"
          pendingLabel="Removing..."
          title="Remove from team"
          description={`${member.email || member.userId} loses access to ${teamName} immediately. They have to be invited again to rejoin.`}
          onRemove={onRemove}
        />
      </TableCell>
    </TableRow>
  );
}

export function TeamMembersTable({
  teamId,
  teamName,
  members,
  memberCount,
}: {
  teamId: string;
  teamName: string;
  members: AdminTeamSectionList<AdminTeamMember>;
  memberCount: number;
}) {
  const { items, hasMore } = members;
  // Role labels only: the rest of the admin surface is deliberately English. These keys already
  // exist in every catalog for the team dashboard, so reusing them adds none.
  const tTeams = useTranslations("Client.Dashboard.Teams");
  const router = useRouter();

  const { executeAsync: removeMember } = useAction(removeTeamMemberAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to remove the member");
    },
    onSuccess: () => {
      toast.success("Member removed from the team");
      router.refresh();
    },
  });

  const description = hasMore
    ? `The first ${items.length} of ${memberCount} members. Open a member to see their account.`
    : "Everyone in this team. Open a member to see their account.";

  return (
    <AdminDetailSection
      icon={Users}
      title={`Members (${memberCount})`}
      description={description}
      emptyMessage="This team has no members"
      isEmpty={items.length === 0}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((member) => (
            <TeamMemberRow
              key={member.membershipId}
              member={member}
              teamName={teamName}
              roleLabel={formatTeamRoleLabel({ member, translate: tTeams })}
              onRemove={() => removeMember({ teamId, userId: member.userId })}
            />
          ))}
        </TableBody>
      </Table>
    </AdminDetailSection>
  );
}
