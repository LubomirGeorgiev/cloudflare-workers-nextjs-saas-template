"use client"

import { valibotResolver } from "@hookform/resolvers/valibot"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useAction } from "next-safe-action/hooks"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  banUserSchema,
  type BanUserInput,
  type BanUserSchema,
} from "@/schemas/admin-users.schema"
import { banUserAction } from "../../_actions/user-ban-actions"
import { BanDecisionFields } from "./ban-decision-fields"

// The two reason fields are the whole design, not decoration. Two boxes with vague labels would be
// worse than one box with a warning, so the labels say exactly where each one goes.

export function BanUserDialog({
  userId,
  email,
  /** Rendered above the form: the billing consequences staff must not be able to miss. */
  impactSummary,
}: {
  userId: string
  email: string | null
  impactSummary: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [emailConfirmation, setEmailConfirmation] = useState("")

  const form = useForm<BanUserInput, unknown, BanUserSchema>({
    resolver: valibotResolver(banUserSchema),
    defaultValues: {
      userId,
      internalReason: "",
      externalReason: undefined,
      sendEmail: true,
      alsoBlockEmail: false,
    },
  })

  const { execute, isExecuting } = useAction(banUserAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Could not ban the account.")
    },
    onSuccess: ({ data }) => {
      if (data?.noticeOutcome === "queue-failed") {
        toast.warning("Account banned. The notice could not be queued; send it by hand.")
      } else {
        toast.success(
          data?.noticeOutcome === "queued"
            ? "Account banned. A notice was queued."
            : "Account banned. No notice was sent.",
        )
      }
      setIsOpen(false)
      setEmailConfirmation("")
      form.reset()
    },
  })

  // The form holds the schema INPUT, where `sendEmail` is optional; its default is `true`.
  const sendEmail = form.watch("sendEmail") ?? true
  const hasEmail = Boolean(email)
  // Cancelling somebody's billing on a misclick is not recoverable by an unban, so the ban asks
  // the acting admin to type the address first.
  const isConfirmed = emailConfirmation.trim().toLowerCase() === (email ?? "").toLowerCase()

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger render={<Button variant="destructive" />}>Ban this account</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ban this account</DialogTitle>
          <DialogDescription>
            The account stays in the database. The person loses every way to sign in, and their API
            keys and connected applications are revoked. Revocation is immediate here and takes up
            to about 60 seconds to reach every location.
          </DialogDescription>
        </DialogHeader>

        {impactSummary}

        <Form {...form}>
          <form onSubmit={form.handleSubmit((values) => execute(values))} className="space-y-5 pt-2">
            <BanDecisionFields
              control={form.control}
              sendEmail={sendEmail}
              hasEmail={hasEmail}
              internalReasonPlaceholder="Card testing from 40+ accounts"
              externalReasonPlaceholder="Repeated chargebacks on this account."
              sendEmailLabel="Email the user about this ban"
              sendEmailDescription={
                "Unchecking this bans the account silently. Emailing a confirmed fraudster " +
                "invites bounces and spam complaints, which cost sender reputation."
              }
            />

            <FormField
              control={form.control}
              name="alsoBlockEmail"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      disabled={!hasEmail}
                      onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Also block this address from registering again</FormLabel>
                    <FormDescription>
                      Adds an ordinary blocklist entry. It stops new sign-ups at this address and
                      bans nobody else.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            {hasEmail ? (
              <div className="space-y-2">
                <Label htmlFor="ban-confirm-email">
                  Type <span className="font-mono">{email}</span> to confirm
                </Label>
                <Input
                  id="ban-confirm-email"
                  autoComplete="off"
                  value={emailConfirmation}
                  onChange={(event) => setEmailConfirmation(event.target.value)}
                />
              </div>
            ) : null}

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button
                type="submit"
                variant="destructive"
                disabled={isExecuting || (hasEmail && !isConfirmed)}
              >
                {isExecuting ? "Banning..." : "Ban and revoke access"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
