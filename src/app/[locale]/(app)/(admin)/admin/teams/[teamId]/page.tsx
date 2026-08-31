import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { cache, Suspense } from "react"

import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ADMIN_TEAMS_PATH } from "@/constants"
import { ActionError } from "@/lib/action-error"
import { getAdminTeamHeader } from "@/lib/admin/teams"
import { requireAdmin } from "@/utils/auth"
import { AdminDetailSectionsSkeleton } from "../../_components/admin-detail-section"
import { RenameTeam } from "../../_components/teams/rename-team"
import { TeamOverviewCards } from "../../_components/teams/team-overview-cards"
import { TeamSections } from "../../_components/teams/team-sections"

interface TeamDetailPageProps {
  params: Promise<{ teamId: string }>
}

// generateMetadata and the render both need the header, and both run in the same RSC pass. Only a
// missing team resolves to null: any other failure (a D1 blip) has to reach the error boundary
// rather than render a confident 404.
const readTeamHeader = cache(async (teamId: string) => {
  await requireAdmin()

  try {
    return await getAdminTeamHeader({ teamId })
  } catch (error) {
    if (error instanceof ActionError && error.code === "NOT_FOUND") {
      return null
    }

    throw error
  }
})

export async function generateMetadata({ params }: TeamDetailPageProps): Promise<Metadata> {
  const { teamId } = await params

  const team = await readTeamHeader(teamId)
  if (!team) {
    return {
      title: "Team Not Found",
      description: "The requested team could not be found",
    }
  }

  return {
    title: `${team.name} - Team Details`,
    description: `Team details for ${team.slug}`,
  }
}

export default async function TeamDetailPage({ params }: TeamDetailPageProps) {
  const { teamId } = await params

  const team = await readTeamHeader(teamId)
  if (!team) {
    notFound()
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <PageHeader
        items={[
          { href: "/admin", label: "Admin" },
          { href: ADMIN_TEAMS_PATH, label: "Teams" },
          { href: `${ADMIN_TEAMS_PATH}/${team.id}`, label: team.name },
        ]}
      />

      <div className="grid gap-6 mt-6">
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-0">
                <CardTitle className="text-2xl">{team.name}</CardTitle>
                <CardDescription className="text-base mt-1">
                  Team ID: {team.id}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{team.planId}</Badge>
                {team.subscriptionStatus ? (
                  <Badge variant="default">{team.subscriptionStatus}</Badge>
                ) : (
                  <Badge variant="outline">no subscription</Badge>
                )}
                <RenameTeam teamId={team.id} currentName={team.name} />
              </div>
            </div>
          </CardHeader>
        </Card>

        <TeamOverviewCards
          slug={team.slug}
          description={team.description}
          createdAt={team.createdAt}
          memberCount={team.memberCount}
          planId={team.planId}
          subscriptionStatus={team.subscriptionStatus}
          billingEmail={team.billingEmail}
          stripeCustomerId={team.stripeCustomerId}
          stripeSubscriptionId={team.stripeSubscriptionId}
        />

        <Suspense fallback={<AdminDetailSectionsSkeleton />}>
          <TeamSections teamId={team.id} teamName={team.name} memberCount={team.memberCount} />
        </Suspense>
      </div>
    </div>
  )
}
