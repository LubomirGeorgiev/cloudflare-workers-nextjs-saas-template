import { getDB } from "@/db";
import { teamTable } from "@/db/schema";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { hasTeamMembership, hasTeamPermission } from "@/utils/team-auth";
import { TEAM_PERMISSIONS } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getSessionFromCookie } from "@/utils/auth";
import { InviteMemberModal } from "@/components/teams/invite-member-modal";
import { Alert } from "@heroui/react";
import { getTeamMembers } from "@/server/team-members";
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

interface TeamPageProps {
  params: Promise<{
    teamSlug: string;
  }>;
}

// TODO Test the removal process
export async function generateMetadata({ params }: TeamPageProps) {
  const { teamSlug } = await params;
  const db = getDB();

  const team = await db.query.teamTable.findFirst({
    where: eq(teamTable.slug, teamSlug),
  });

  if (!team) {
    return {
      title: "Team Not Found",
    };
  }

  return {
    title: `${team.name} - Dashboard`,
    description: team.description || `Team dashboard for ${team.name}`,
  };
}

export default async function TeamDashboardPage({ params }: TeamPageProps) {
  const { teamSlug } = await params;
  const db = getDB();

  // Find the team by slug
  const team = await db.query.teamTable.findFirst({
    where: eq(teamTable.slug, teamSlug),
  });

  if (!team) {
    notFound();
  }

  // Check if user is authenticated
  const session = await getSessionFromCookie();
  if (!session) {
    redirect("/sign-in?returnTo=" + encodeURIComponent(`/dashboard/teams/${teamSlug}`));
  }

  // Check team membership using the new function
  const { hasAccess, session: teamSession } = await hasTeamMembership(team.id);

  // If user doesn't have access, show error message
  if (!hasAccess) {
    return (
      <>
        <PageHeader
          items={[
            {
              href: "/dashboard/teams",
              label: "Teams"
            }
          ]}
        />
        <div className="container mx-auto px-5 py-12">
          <Alert
            color="danger"
            title="Access Denied"
            description={`You don't have permission to access team "${team.name}". Please contact the team owner to request access.`}
            className="mb-6"
          />
          <Button asChild className="mt-4">
            <Link href="/dashboard/teams">
              Return to Teams
            </Link>
          </Button>
        </div>
      </>
    );
  }

  // Check permissions
  const canInviteMembers = await hasTeamPermission(team.id, TEAM_PERMISSIONS.INVITE_MEMBERS);
  const canRemoveMembers = await hasTeamPermission(team.id, TEAM_PERMISSIONS.REMOVE_MEMBERS);

  // Fetch team members
  const teamMembers = await getTeamMembers(team.id);

  return (
    <>
      <PageHeader
        items={[
          {
            href: "/dashboard/teams",
            label: "Teams"
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
            {canInviteMembers && (
              <InviteMemberModal
                teamId={team.id}
                trigger={
                  <Button>Invite Members</Button>
                }
              />
            )}

            {team.avatarUrl ? (
              <div className="h-16 w-16 rounded-md overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
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
          <div className="col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-6 border rounded-lg bg-card flex flex-col">
              <span className="text-sm font-medium text-muted-foreground">Team Credits</span>
              <span className="text-2xl font-bold">{team.creditBalance || 0}</span>
            </div>

            <div className="p-6 border rounded-lg bg-card flex flex-col">
              <span className="text-sm font-medium text-muted-foreground">Your Role</span>
              <span className="text-2xl font-bold capitalize">
                {teamSession?.teams?.find(t => t.id === team.id)?.role.name || "Member"}
              </span>
            </div>

            <div className="p-6 border rounded-lg bg-card flex flex-col">
              <span className="text-sm font-medium text-muted-foreground">Created</span>
              <span className="text-2xl font-bold">
                {new Date(team.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>

          {/* Team actions */}
          <div className="col-span-3 flex flex-wrap gap-4">
          </div>

          {/* Team Members Table */}
          <div className="col-span-3 border rounded-lg p-6 bg-card">
            <h2 className="text-xl font-semibold mb-4">Team Members</h2>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Status</TableHead>
                  {canRemoveMembers && <TableHead className="text-right">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {teamMembers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canRemoveMembers ? 6 : 5} className="text-center py-6 text-muted-foreground">
                      No members found
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
                        {member.roleName}
                      </TableCell>
                      <TableCell>
                        {member.joinedAt !== null
                          ? formatDate(member.joinedAt)
                          : 'Not joined'}
                      </TableCell>
                      <TableCell>
                        {member.isActive
                          ? <span className="text-green-600 dark:text-green-400">Active</span>
                          : <span className="text-red-600 dark:text-red-400">Inactive</span>}
                      </TableCell>
                      {canRemoveMembers && (
                        <TableCell className="text-right">
                          <RemoveMemberButton
                            teamId={team.id}
                            userId={member.userId}
                            memberName={`${member.user.firstName || ''} ${member.user.lastName || ''}`.trim() || member.user.email || ''}
                            isDisabled={member.isSystemRole && member.roleId === 'owner'}
                            tooltipText="Team owners cannot be removed"
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </>
  );
}
