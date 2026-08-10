import { Suspense } from "react";

import { hasTeamPermission } from "@/utils/team-auth";
import { TEAM_PERMISSIONS } from "@/db/schema";
import { formatTeamRoleLabel } from "@/lib/teams/team-role-labels";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { InviteMemberModal } from "@/components/teams/invite-member-modal";
import { RenameTeamModal } from "@/components/teams/rename-team-modal";
import { getTeamMemberManagementData } from "@/lib/teams/team-members";
import { requireTeamAccess } from "./team-page-guard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatDate } from "@/utils/format-date";
import { RemoveMemberButton } from "@/components/teams/remove-member-button";
import { RevokeInvitationButton } from "@/components/teams/revoke-invitation-button";
import { TeamApiKeys } from "@/components/teams/team-api-keys";
import { Skeleton } from "@/components/ui/skeleton";
import { type Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/translator";

interface TeamPageProps {
  params: Promise<{
    teamSlug: string;
    locale: Locale;
  }>;
}

// TODO Test the removal process
export async function generateMetadata({ params }: TeamPageProps) {
  const { teamSlug, locale } = await params;
  const t = await getTranslator({ locale, namespace: "Client.Dashboard.Teams" });

  const { team } = await requireTeamAccess(teamSlug);

  return {
    title: t("teamMetaTitle", { name: team.name }),
    description: team.description || t("teamMetaDescription", { name: team.name }),
  };
}

export default async function TeamDashboardPage({ params }: TeamPageProps) {
  const { teamSlug, locale } = await params;
  const t = await getTranslator({ locale, namespace: "Client.Dashboard.Teams" });

  const { team, session } = await requireTeamAccess(teamSlug);

  // Independent reads of the same request-cached membership; requireTeamAccess above is the
  // access guard and must stay sequential.
  const [canInviteMembers, canRemoveMembers, canEditTeamSettings, canManageApiKeys] = await Promise.all([
    hasTeamPermission(team.id, TEAM_PERMISSIONS.INVITE_MEMBERS),
    hasTeamPermission(team.id, TEAM_PERMISSIONS.REMOVE_MEMBERS),
    hasTeamPermission(team.id, TEAM_PERMISSIONS.EDIT_TEAM_SETTINGS),
    hasTeamPermission(team.id, TEAM_PERMISSIONS.MANAGE_API_KEYS),
  ]);

  const {
    canRevokeInvitations,
    members: teamMembers,
    pendingInvitations,
  } = await getTeamMemberManagementData(team.id);

  return (
    <>
      <PageHeader
        items={[
          {
            href: "/dashboard/teams",
            label: t("breadcrumb")
          },
          {
            href: `/dashboard/teams/${teamSlug}`,
            label: team.name
          }
        ]}
      />
      <div className="container mx-auto px-5 pb-12">
        <div className="flex justify-between items-start mb-8">
          <div className="flex items-center gap-4">
            <div className="space-y-2">
              <h1 className="text-4xl font-bold mt-4">{team.name}</h1>
              {team.description && (
                <p className="text-muted-foreground mt-2">{team.description}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            {canEditTeamSettings && (
              <RenameTeamModal
                teamId={team.id}
                currentName={team.name}
                trigger={
                  <Button variant="outline">{t("renameTeam")}</Button>
                }
              />
            )}

            {canInviteMembers && (
              <InviteMemberModal
                teamId={team.id}
                trigger={
                  <Button>{t("inviteMembers")}</Button>
                }
              />
            )}

            {team.avatarUrl ? (
              <div className="h-16 w-16 rounded-md overflow-hidden">
                {/* oxlint-disable-next-line nextjs/no-img-element */}
                <img
                  src={team.avatarUrl || ""}
                  alt={`${team.name} avatar`}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Quick stats */}
          <div className="col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-6 border rounded-lg bg-card flex flex-col">
              <span className="text-sm font-medium text-muted-foreground">{t("yourRoleLabel")}</span>
              <span className="text-2xl font-bold capitalize">
                {session.teams?.find(team2 => team2.id === team.id)?.role.name || t("memberRole")}
              </span>
            </div>

            <div className="p-6 border rounded-lg bg-card flex flex-col">
              <span className="text-sm font-medium text-muted-foreground">{t("created")}</span>
              <span className="text-2xl font-bold">
                {formatDate(team.createdAt, locale)}
              </span>
            </div>
          </div>

          {/* Team actions */}
          <div className="col-span-3 flex flex-wrap gap-4">
          </div>

          {/* Team Members Table */}
          <div className="col-span-3 border rounded-lg p-6 bg-card">
            <h2 className="text-xl font-semibold mb-4">{t("teamMembers")}</h2>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columnMember")}</TableHead>
                  <TableHead>{t("columnEmail")}</TableHead>
                  <TableHead>{t("columnRole")}</TableHead>
                  <TableHead>{t("columnJoined")}</TableHead>
                  <TableHead>{t("columnStatus")}</TableHead>
                  {canRemoveMembers && <TableHead className="text-right">{t("columnAction")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {teamMembers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canRemoveMembers ? 6 : 5} className="text-center py-6 text-muted-foreground">
                      {t("noMembersFound")}
                    </TableCell>
                  </TableRow>
                ) : (
                  teamMembers.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage
                            src={member.user.avatar || ''}
                            alt={`${member.user.firstName || ''} ${member.user.lastName || ''}`}
                          />
                          <AvatarFallback>
                            {member.user.firstName?.[0]}{member.user.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <span>
                          {member.user.firstName} {member.user.lastName}
                        </span>
                      </TableCell>
                      <TableCell>{member.user.email}</TableCell>
                      <TableCell className="capitalize">
                        {formatTeamRoleLabel({ member, translate: t })}
                      </TableCell>
                      <TableCell>
                        {member.joinedAt !== null
                          ? formatDate(member.joinedAt, locale)
                          : t("notJoined")}
                      </TableCell>
                      <TableCell>
                        {member.isActive
                          ? <span className="text-green-600 dark:text-green-400">{t("statusActive")}</span>
                          : <span className="text-red-600 dark:text-red-400">{t("statusInactive")}</span>}
                      </TableCell>
                      {canRemoveMembers && (
                        <TableCell className="text-right">
                          <RemoveMemberButton
                            teamId={team.id}
                            userId={member.userId}
                            memberName={`${member.user.firstName || ''} ${member.user.lastName || ''}`.trim() || member.user.email || ''}
                            isDisabled={member.isSystemRole && member.roleId === 'owner'}
                            tooltipText={t("ownerCannotBeRemoved")}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {pendingInvitations.length > 0 && (
            <div className="col-span-3 border rounded-lg p-6 bg-card">
              <h2 className="text-xl font-semibold mb-4">{t("pendingInvitationsTitle")}</h2>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columnEmail")}</TableHead>
                    <TableHead>{t("columnRole")}</TableHead>
                    <TableHead>{t("columnInvited")}</TableHead>
                    <TableHead>{t("columnExpires")}</TableHead>
                    <TableHead>{t("columnStatus")}</TableHead>
                    {canRevokeInvitations && (
                      <TableHead className="text-right">{t("columnAction")}</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingInvitations.map((invitation) => (
                    <TableRow key={invitation.id}>
                      <TableCell>{invitation.email}</TableCell>
                      <TableCell className="capitalize">
                        {formatTeamRoleLabel({ member: invitation, translate: t })}
                      </TableCell>
                      <TableCell>{formatDate(invitation.createdAt, locale)}</TableCell>
                      <TableCell>{formatDate(invitation.expiresAt, locale)}</TableCell>
                      <TableCell>{t("statusPending")}</TableCell>
                      {canRevokeInvitations && (
                        <TableCell className="text-right">
                          <RevokeInvitationButton
                            email={invitation.email}
                            invitationId={invitation.id}
                            teamId={team.id}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {canManageApiKeys && (
            <Suspense fallback={<Skeleton className="col-span-3 h-48 w-full" />}>
              <TeamApiKeys teamId={team.id} />
            </Suspense>
          )}
        </div>
      </div>
    </>
  );
}
