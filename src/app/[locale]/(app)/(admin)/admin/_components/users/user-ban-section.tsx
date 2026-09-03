import { format } from "date-fns"
import { AlertTriangle, ShieldOff } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ADMIN_TEAMS_PATH, ADMIN_USERS_PATH } from "@/constants"
import { DEFAULT_LOCALE } from "@/i18n/config"
import { Link } from "@/i18n/navigation"
import type { TeamBillingRisk } from "@/lib/admin/team-billing-admin"
import { getUserBanImpact, listUserBanEvents, type UserBanEvent } from "@/lib/admin/user-ban"
import { formatPrice } from "@/utils/format-price"
import { BanUserDialog } from "./ban-user-dialog"
import { UnbanUserDialog } from "./unban-user-dialog"

// Streams in behind its own Suspense boundary: the impact read touches D1, KV, and Stripe.
// `getUserBanImpact` and `listUserBanEvents` are pure data layers, so the page guards with
// `requireAdmin` before this renders.

const ABSOLUTE_DATE_FORMAT = "PPpp"

/** One owned team, stated as consequences rather than as data. */
function OwnedTeamRow({ team }: { team: TeamBillingRisk }) {
  const otherMembers = Math.max(team.memberCount - 1, 0)

  return (
    <li className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`${ADMIN_TEAMS_PATH}/${team.teamId}`} className="font-medium underline">
          {team.teamName}
        </Link>
        <Badge variant="secondary">{team.plan.name}</Badge>
        {team.interval ? <Badge variant="outline">{team.interval}</Badge> : null}
        {team.subscriptionStatus ? (
          <Badge variant="outline">{team.subscriptionStatus}</Badge>
        ) : null}
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {team.stripeSubscriptionId ? (
          <li>Its subscription is cancelled immediately. There is no refund and no credit.</li>
        ) : (
          <li>No active subscription; nothing to cancel.</li>
        )}
        {otherMembers > 0 ? (
          <li className="font-medium text-foreground">
            {otherMembers} other {otherMembers === 1 ? "person loses" : "people lose"} their paid
            plan today.
          </li>
        ) : null}
        {team.openInvoices.count > 0 && team.openInvoices.currency ? (
          <li>
            {formatPrice({
              amount: team.openInvoices.totalAmount,
              currency: team.openInvoices.currency,
              locale: DEFAULT_LOCALE,
            })}{" "}
            across {team.openInvoices.count} unpaid{" "}
            {team.openInvoices.count === 1 ? "invoice" : "invoices"} stops being collected
            automatically. The debt is not written off; re-enable it per invoice in Stripe.
          </li>
        ) : null}
      </ul>
    </li>
  )
}

function BanImpactSummary({ impact }: { impact: Awaited<ReturnType<typeof getUserBanImpact>> }) {
  return (
    <div className="space-y-4 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4" />
        This cannot be undone. Lifting the ban does not restore the subscription — the team has to
        subscribe again, and the unused part of the period is not refunded.
      </p>

      <p>
        {impact.activeApiKeyCount} API {impact.activeApiKeyCount === 1 ? "key" : "keys"} and{" "}
        {impact.connectedAppCount} connected{" "}
        {impact.connectedAppCount === 1 ? "application" : "applications"} will be revoked.{" "}
        {impact.pendingInvitationCount > 0
          ? `${impact.pendingInvitationCount} pending invitation${impact.pendingInvitationCount === 1 ? "" : "s"} they sent will be revoked too.`
          : "They have no pending invitations."}
      </p>

      {impact.ownedTeams.length > 0 ? (
        <div className="space-y-2">
          <p className="font-medium">Teams they own</p>
          <ul className="space-y-2">
            {impact.ownedTeams.map((team) => (
              <OwnedTeamRow key={team.teamId} team={team} />
            ))}
          </ul>
        </div>
      ) : (
        <p>They own no team, so no subscription is cancelled.</p>
      )}

      {impact.memberOnlyTeams.length > 0 ? (
        <div className="space-y-1">
          <p className="font-medium">Teams they only belong to — not affected</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {impact.memberOnlyTeams.map((team) => (
              <li key={team.teamId}>
                <Link href={`${ADMIN_TEAMS_PATH}/${team.teamId}`} className="underline">
                  {team.teamName}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function BanHistory({ events }: { events: UserBanEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">This account has never been banned.</p>
  }

  return (
    <ul className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={event.action === "ban" ? "destructive" : "default"}>
              {event.action === "ban" ? "Banned" : "Unbanned"}
            </Badge>
            <span className="text-muted-foreground">
              {format(event.createdAt, ABSOLUTE_DATE_FORMAT)}
            </span>
            {event.actorUserId ? (
              <span className="text-xs text-muted-foreground">
                by{" "}
                <Link
                  href={`${ADMIN_USERS_PATH}/${event.actorUserId}`}
                  title={event.actorUserId}
                  className={event.actorName ? "underline" : "font-mono underline"}
                >
                  {event.actorName ?? event.actorUserId}
                </Link>
              </span>
            ) : null}
          </div>
          <p className="mt-2">
            <span className="font-medium">Internal reason:</span> {event.internalReason}
          </p>
          {event.externalReason ? (
            <p className="mt-1">
              <span className="font-medium">Sent to the user:</span> {event.externalReason}
            </p>
          ) : null}
          <p className="mt-1 text-muted-foreground">
            {event.noticeQueuedAt ? "A notice was emailed." : "No notice was emailed."}
            {event.cancelledSubscriptionCount
              ? ` ${event.cancelledSubscriptionCount} subscription${event.cancelledSubscriptionCount === 1 ? "" : "s"} cancelled.`
              : ""}
          </p>
        </li>
      ))}
    </ul>
  )
}

export async function UserBanSection({ userId }: { userId: string }) {
  const [impact, events] = await Promise.all([
    getUserBanImpact({ userId }),
    listUserBanEvents({ userId }),
  ])

  const latestBan = events.find((event) => event.action === "ban")
  // A team still holding a subscription id after a ban means a retry has not landed yet.
  const cancellationPending = impact.isBanned
    ? impact.ownedTeams.filter((team) => team.stripeSubscriptionId)
    : []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldOff className="h-5 w-5" />
          Account suspension
        </CardTitle>
        <CardDescription>
          A ban keeps the account and takes away every way to authenticate. It never deletes
          anything, never removes a team member, and never transfers ownership.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {impact.isAdmin ? (
          <p className="text-sm text-muted-foreground">
            This account is an admin. Change its role to <code>user</code> before banning it, so a
            banned account is never an admin account.
          </p>
        ) : impact.isBanned ? (
          <div className="space-y-4">
            <p className="text-sm">
              Banned{latestBan ? ` on ${format(latestBan.createdAt, ABSOLUTE_DATE_FORMAT)}` : ""}.
            </p>
            {cancellationPending.length > 0 ? (
              <p className="text-sm text-destructive">
                Subscription cancellation pending on{" "}
                {cancellationPending.map((team) => team.teamName).join(", ")}. A retry job is
                queued; check back, and cancel by hand in Stripe if it stays stuck.
              </p>
            ) : null}
            <UnbanUserDialog
              userId={userId}
              email={impact.email}
              cancelledSubscriptionCount={latestBan?.cancelledSubscriptionCount ?? 0}
            />
          </div>
        ) : (
          <BanUserDialog
            userId={userId}
            email={impact.email}
            impactSummary={<BanImpactSummary impact={impact} />}
          />
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">Ban history</p>
          <BanHistory events={events} />
        </div>
      </CardContent>
    </Card>
  )
}
