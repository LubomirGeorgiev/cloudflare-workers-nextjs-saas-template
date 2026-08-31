import type { Metadata } from "next"
import { NuqsAdapter } from "nuqs/adapters/next/app"

import { PageHeader } from "@/components/page-header"
import { ADMIN_TEAMS_PATH } from "@/constants"
import { TeamsTable } from "../_components/teams/teams-table"

export const metadata: Metadata = {
  title: "Team Management",
  description: "Manage all teams",
}

export default function AdminTeamsPage() {
  return (
    <NuqsAdapter>
      <PageHeader
        items={[
          { href: "/admin", label: "Admin" },
          { href: ADMIN_TEAMS_PATH, label: "Teams" },
        ]}
      />
      <TeamsTable />
    </NuqsAdapter>
  )
}
