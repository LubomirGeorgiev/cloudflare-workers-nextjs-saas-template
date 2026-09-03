"use client"

import { valibotResolver } from "@hookform/resolvers/valibot"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useAction } from "next-safe-action/hooks"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Textarea } from "@/components/ui/textarea"
import { DEFAULT_LOCALE } from "@/i18n/config"
import type { TeamOpenInvoices } from "@/lib/admin/team-billing-admin"
import {
  cancelTeamSubscriptionSchema,
  type CancelTeamSubscriptionSchema,
} from "@/schemas/admin-teams.schema"
import { formatPrice } from "@/utils/format-price"
import { cancelTeamSubscriptionAction } from "../../_actions/team-actions"

export function CancelTeamSubscription({
  teamId,
  subscriptionStatus,
  memberCount,
  openInvoices,
}: {
  teamId: string
  subscriptionStatus: string | null
  memberCount: number
  openInvoices: TeamOpenInvoices
}) {
  const [isOpen, setIsOpen] = useState(false)

  const form = useForm<CancelTeamSubscriptionSchema>({
    resolver: valibotResolver(cancelTeamSubscriptionSchema),
    defaultValues: { teamId, reason: "" },
  })

  const { execute, isExecuting } = useAction(cancelTeamSubscriptionAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Could not cancel the subscription.")
    },
    onSuccess: () => {
      toast.success("Subscription cancelled.")
      setIsOpen(false)
      form.reset({ teamId, reason: "" })
    },
  })

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger render={<Button variant="destructive" />}>Cancel subscription</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this team&apos;s subscription</DialogTitle>
          <DialogDescription>
            Immediately, not at the end of the period. Cancelling is not refunding: issue a refund
            by hand in Stripe if one is owed.
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-4 pl-8 text-sm">
          <li>
            Current status: <span className="font-mono">{subscriptionStatus ?? "unknown"}</span>.
          </li>
          <li>
            All {memberCount} {memberCount === 1 ? "member" : "members"} drop to the free plan
            today, even though the period is paid for.
          </li>
          {openInvoices.count > 0 && openInvoices.currency ? (
            <li>
              {formatPrice({
                amount: openInvoices.totalAmount,
                currency: openInvoices.currency,
                locale: DEFAULT_LOCALE,
              })}{" "}
              across {openInvoices.count} unpaid{" "}
              {openInvoices.count === 1 ? "invoice" : "invoices"} stops being collected
              automatically. Stripe does this on every cancel; the debt is not written off.
            </li>
          ) : null}
          <li>The Stripe customer, its invoice history, and saved cards all stay.</li>
        </ul>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((values) => execute(values))} className="space-y-5 pt-2">
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Refund agreed with the customer" rows={2} {...field} />
                  </FormControl>
                  <FormDescription>
                    Recorded on Stripe as the cancellation comment, so finance can reconstruct why.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Keep it</DialogClose>
              <Button type="submit" variant="destructive" disabled={isExecuting}>
                {isExecuting ? "Cancelling..." : "Cancel subscription"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
