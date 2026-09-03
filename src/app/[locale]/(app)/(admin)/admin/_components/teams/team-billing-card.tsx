import { CreditCard } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getTeamBillingRisk } from "@/lib/admin/team-billing-admin"
import { CancelTeamSubscription } from "./cancel-team-subscription"

// Rendered only for a team that has a subscription to cancel. Its own Suspense boundary on the
// page, because the open-invoice total is a Stripe call.
//
// There is deliberately no ownership transfer control here. A banned or absent owner stays the
// owner on paper; a silent privilege grant is worse than a frozen team.
export async function TeamBillingCard({ teamId }: { teamId: string }) {
  const risk = await getTeamBillingRisk({ teamId })

  if (!risk.stripeSubscriptionId) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Billing
        </CardTitle>
        <CardDescription>
          Staff cancellation, through the same code path the ban uses. Immediate, never at period
          end, and it bills anything already owed rather than discarding it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CancelTeamSubscription
          teamId={teamId}
          subscriptionStatus={risk.subscriptionStatus}
          memberCount={risk.memberCount}
          openInvoices={risk.openInvoices}
        />
      </CardContent>
    </Card>
  )
}
