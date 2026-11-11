import { SlidersHorizontal } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { loadTeamLimitOverrides, type TeamLimitOverridesView } from "@/lib/admin/team-limit-overrides"
import { LimitOverridesForm } from "./limit-overrides-form"

// Staff limit overrides of one team. Its own Suspense boundary on the page. English only, like
// the rest of the admin area.
export async function TeamLimitOverridesCard({ teamId }: { teamId: string }) {
  const view = await loadTeamLimitOverrides({ teamId })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5" />
          Plan limit overrides
        </CardTitle>
        <CardDescription>
          For a custom deal with one team. An override replaces the plan value, add-ons included; it
          is not added to it. It stays when the plan changes while the team pays. On a paid plan
          with no paid access it is suspended, and when the subscription ends it is removed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          A lower limit deletes nothing. The team keeps its members, and cannot add more until it is
          under the limit, as after a downgrade.
        </p>
        <OverrideState view={view} />
        <LimitOverridesForm
          teamId={teamId}
          planLimits={view.planLimits}
          overrides={view.overrides}
          appliedOverrides={view.appliedOverrides}
          limits={view.limits}
          isSuspended={!view.isActive}
          hideFromCustomer={view.hideFromCustomer}
        />
      </CardContent>
    </Card>
  )
}

/** The state of the stored overrides now. `isActive` comes from getTeamEntitlements, as the limits do. */
function OverrideState({ view }: { view: TeamLimitOverridesView }) {
  const hasOverrides = Object.keys(view.overrides).length > 0

  if (!view.isActive) {
    return (
      <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">Suspended</Badge>
          {view.hideFromCustomer ? <Badge variant="outline">Hidden from the customer</Badge> : null}
        </div>
        <p>
          No paid access: the payment failed, or the subscription is not active. The team gets the
          Free limits. An override applies only where it is below the Free value. The other
          overrides apply again when the payment succeeds, and they are removed when the
          subscription ends.
        </p>
      </div>
    )
  }
  if (!hasOverrides) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Badge variant="success">Applies now</Badge>
      {view.hideFromCustomer ? <Badge variant="outline">Hidden from the customer</Badge> : null}
    </div>
  )
}
