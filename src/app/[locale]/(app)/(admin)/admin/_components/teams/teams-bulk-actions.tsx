"use client"

import { Button } from "@/components/ui/button"
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard"
import { toCsv } from "@/utils/csv"
import type { Team } from "./columns"

/** Column order of the CSV a bulk copy produces, so a paste into a sheet lands with column names. */
const CSV_HEADER = ["id", "name", "slug", "members", "plan", "subscriptionStatus"]

export function toTeamsCsv(teams: Team[]): string {
  return toCsv({
    header: CSV_HEADER,
    rows: teams.map((team) => [
      team.id,
      team.name,
      team.slug,
      team.memberCount,
      team.planId,
      team.subscriptionStatus,
    ]),
  })
}

// Deliberately read-only. Bulk deletion of teams would cascade through memberships, invitations,
// roles, API keys, and a live Stripe subscription, so it is a per-team decision, not a checkbox.
export function TeamsBulkActions({
  teams,
  onClear,
}: {
  teams: Team[]
  onClear: () => void
}) {
  const { copy } = useCopyToClipboard()

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3">
      <span className="text-sm font-medium">{teams.length} selected on this page</span>
      <div className="ml-auto flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => copy(
            teams.map((team) => team.id).join("\n"),
            { successMessage: "Team IDs copied" },
          )}
        >
          Copy IDs
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => copy(
            teams.map((team) => team.slug).join("\n"),
            { successMessage: "Slugs copied" },
          )}
        >
          Copy slugs
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => copy(toTeamsCsv(teams), { successMessage: "Selected teams copied as CSV" })}
        >
          Copy as CSV
        </Button>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  )
}
