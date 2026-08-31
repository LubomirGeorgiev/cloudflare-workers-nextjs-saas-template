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
import { ADMIN_TEAMS_PATH } from "@/constants";
import { Link } from "@/i18n/navigation";
import type { AdminTeamMembership } from "@/lib/admin/user-credentials";
import { formatTeamRoleLabel } from "@/lib/teams/team-role-labels";
import { removeUserFromTeamAction } from "../../_actions/user-credentials-actions";
import { RelativeDateCell } from "../relative-date-cell";
import { RemoveTeamMemberControl } from "../remove-team-member-control";
import { AdminDetailSection } from "../admin-detail-section";

export function UserTeams({ userId, teams }: { userId: string; teams: AdminTeamMembership[] }) {
  const t = useTranslations("Client.Admin.UserDetail");
  const tTeams = useTranslations("Client.Dashboard.Teams");
  const router = useRouter();

  const { executeAsync: removeFromTeam } = useAction(removeUserFromTeamAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || t("toastRemoveTeamError"));
    },
    onSuccess: () => {
      toast.success(t("toastRemoveTeamSuccess"));
      router.refresh();
    },
  });

  return (
    <AdminDetailSection
      icon={Users}
      title={t("teamsTitle", { count: teams.length })}
      description={t("teamsDescription")}
      emptyMessage={t("teamsEmpty")}
      isEmpty={teams.length === 0}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columnTeam")}</TableHead>
            <TableHead>{t("columnRole")}</TableHead>
            <TableHead>{t("columnJoined")}</TableHead>
            <TableHead>{t("columnStatus")}</TableHead>
            <TableHead className="text-right">{t("columnAction")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {teams.map((membership) => (
            <TableRow key={membership.membershipId}>
              <TableCell>
                <Link
                  href={`${ADMIN_TEAMS_PATH}/${membership.teamId}`}
                  className="flex flex-col hover:underline"
                >
                  <span className="font-medium">{membership.teamName}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {membership.teamSlug}
                  </span>
                </Link>
              </TableCell>
              <TableCell className="capitalize">
                {formatTeamRoleLabel({ member: membership, translate: tTeams })}
              </TableCell>
              <TableCell>
                <RelativeDateCell value={membership.joinedAt} emptyLabel={t("notJoined")} />
              </TableCell>
              <TableCell>
                {membership.isActive
                  ? <span className="text-green-600 dark:text-green-400">{t("statusActive")}</span>
                  : <span className="text-red-600 dark:text-red-400">{t("statusInactive")}</span>}
              </TableCell>
              <TableCell className="text-right">
                <RemoveTeamMemberControl
                  member={membership}
                  removeLabel={t("removeFromTeam")}
                  pendingLabel={t("removing")}
                  title={t("removeFromTeamTitle")}
                  description={t("removeFromTeamDescription", { team: membership.teamName })}
                  onRemove={() => removeFromTeam({ userId, teamId: membership.teamId })}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AdminDetailSection>
  );
}
