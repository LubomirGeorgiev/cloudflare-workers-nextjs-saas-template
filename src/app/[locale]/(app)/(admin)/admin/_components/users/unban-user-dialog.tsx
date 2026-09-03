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
import { Form } from "@/components/ui/form"
import {
  unbanUserSchema,
  type UnbanUserInput,
  type UnbanUserSchema,
} from "@/schemas/admin-users.schema"
import { unbanUserAction } from "../../_actions/user-ban-actions"
import { BanDecisionFields } from "./ban-decision-fields"

// The same three controls as the ban dialog, in the same order. Reversing a fraud ban needs an
// author and a justification as much as making one does, so the internal reason is required here
// too, and it is just as unreachable from the email payload.

/**
 * What an unban does NOT restore. Stated before staff confirm, because an unbanned customer who
 * returns to a silently free team with dead API keys is the support ticket this prevents.
 */
function NotRestoredList({ cancelledSubscriptionCount }: { cancelledSubscriptionCount: number }) {
  return (
    <div className="rounded-md border bg-muted/40 p-4 text-sm">
      <p className="font-medium">Unban restores sign-in, and nothing else.</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
        <li>API keys stay revoked. The account has to create new ones.</li>
        <li>OAuth grants stay revoked. Each client has to be re-authorized.</li>
        <li>Sent invitations stay revoked. They have to be re-sent.</li>
        <li>Team memberships were never touched, so they are intact.</li>
        {cancelledSubscriptionCount > 0 ? (
          <li>
            {cancelledSubscriptionCount === 1
              ? "The cancelled subscription is gone"
              : `The ${cancelledSubscriptionCount} cancelled subscriptions are gone`}
            . The owner has to subscribe again, and the unused part of the paid period is not
            refunded — issue a refund by hand in Stripe if one is owed.
          </li>
        ) : null}
        <li>The free trial is not available again; the trial stamp is still set.</li>
      </ul>
    </div>
  )
}

export function UnbanUserDialog({
  userId,
  email,
  cancelledSubscriptionCount,
}: {
  userId: string
  email: string | null
  /** From the latest ban event, so the dialog and the notice tell the same billing story. */
  cancelledSubscriptionCount: number
}) {
  const [isOpen, setIsOpen] = useState(false)

  const form = useForm<UnbanUserInput, unknown, UnbanUserSchema>({
    resolver: valibotResolver(unbanUserSchema),
    defaultValues: {
      userId,
      internalReason: "",
      externalReason: undefined,
      sendEmail: true,
    },
  })

  const { execute, isExecuting } = useAction(unbanUserAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Could not lift the ban.")
    },
    onSuccess: ({ data }) => {
      if (data?.noticeOutcome === "queue-failed") {
        toast.warning("Ban lifted. The notice could not be queued; send it by hand.")
      } else {
        toast.success(
          data?.noticeOutcome === "queued"
            ? "Ban lifted. A notice was queued."
            : "Ban lifted. No notice was sent.",
        )
      }
      setIsOpen(false)
      form.reset()
    },
  })

  // The form holds the schema INPUT, where `sendEmail` is optional; its default is `true`.
  const sendEmail = form.watch("sendEmail") ?? true
  const hasEmail = Boolean(email)

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger render={<Button />}>Lift this ban</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lift this ban</DialogTitle>
          <DialogDescription>
            The account can sign in again as soon as this lands.
          </DialogDescription>
        </DialogHeader>

        <NotRestoredList cancelledSubscriptionCount={cancelledSubscriptionCount} />

        <Form {...form}>
          <form onSubmit={form.handleSubmit((values) => execute(values))} className="space-y-5 pt-2">
            <BanDecisionFields
              control={form.control}
              sendEmail={sendEmail}
              hasEmail={hasEmail}
              internalReasonPlaceholder="Appeal upheld; the chargebacks were fraud on their card"
              externalReasonPlaceholder="Thanks for your patience while we reviewed this."
              sendEmailLabel="Email the user that their account is restored"
              sendEmailDescription="The notice lists what did not come back, not just that access is back."
            />

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button type="submit" disabled={isExecuting}>
                {isExecuting ? "Lifting..." : "Lift this ban"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
