import { format } from "date-fns"
import { Building2, CreditCard, Users } from "lucide-react"
import type { ReactNode } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface TeamOverviewCardsProps {
  slug: string
  description: string | null
  createdAt: Date
  memberCount: number
  planId: string
  subscriptionStatus: string | null
  billingEmail: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
}

/** One labelled read-only field; every row on both cards is one of these. */
function Field({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
        {label}
      </label>
      <p className="text-sm">{value}</p>
    </div>
  )
}

export function TeamOverviewCards({
  slug,
  description,
  createdAt,
  memberCount,
  planId,
  subscriptionStatus,
  billingEmail,
  stripeCustomerId,
  stripeSubscriptionId,
}: TeamOverviewCardsProps) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Team Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Slug" value={<span className="font-mono">{slug}</span>} />
          <Field label="Description" value={description || "Not provided"} />
          <Field label="Created" value={format(createdAt, "PPpp")} />
          <Field
            label={<><Users className="h-3 w-3" />Members</>}
            value={memberCount}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Billing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Plan" value={planId} />
          <Field label="Status" value={subscriptionStatus || "No subscription"} />
          <Field label="Billing email" value={billingEmail || "Not set"} />
          <Field
            label="Stripe customer"
            value={<span className="font-mono">{stripeCustomerId || "None"}</span>}
          />
          <Field
            label="Stripe subscription"
            value={<span className="font-mono">{stripeSubscriptionId || "None"}</span>}
          />
        </CardContent>
      </Card>
    </div>
  )
}
