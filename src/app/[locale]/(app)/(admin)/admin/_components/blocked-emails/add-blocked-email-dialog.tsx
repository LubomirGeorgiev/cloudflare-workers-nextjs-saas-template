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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ADMIN_USERS_PATH } from "@/constants"
import { Link } from "@/i18n/navigation"
import { buildUserEmailFilter, parseEmailPattern } from "@/utils/email-pattern"
import {
  createBlockedEmailSchema,
  type CreateBlockedEmailSchema,
} from "@/schemas/admin-blocked-emails.schema"
import {
  countMatchingUsersAction,
  createBlockedEmailAction,
} from "../../_actions/blocked-email-actions"

const EMPTY_FORM: CreateBlockedEmailSchema = { pattern: "", reason: undefined }

/** The count and the "review them" filter are one fact, so they are set and cleared together. */
interface MatchPreview {
  count: number
  emailFilter: string
}

// The dialog validates with the very schema the server action parses, so the accepted pattern
// format is stated once (see `createBlockedEmailFields`).
export function AddBlockedEmailDialog({ onAdded }: { onAdded: () => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const [preview, setPreview] = useState<MatchPreview | null>(null)

  const form = useForm<CreateBlockedEmailSchema>({
    resolver: valibotResolver(createBlockedEmailSchema),
    defaultValues: EMPTY_FORM,
  })

  const pattern = form.watch("pattern")

  const { execute: countMatches } = useAction(countMatchingUsersAction, {
    onSuccess: ({ data, input }) => {
      const parsed = parseEmailPattern(input.pattern)

      setPreview(
        data && parsed ? { count: data.count, emailFilter: buildUserEmailFilter(parsed) } : null,
      )
    },
    // A failed preview is not worth a toast: the count is advisory and the form still works.
    onError: () => setPreview(null),
  })

  const { execute: create, isExecuting } = useAction(createBlockedEmailAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Could not add the entry.")
    },
    onSuccess: () => {
      toast.success("Pattern added to the blocklist.")
      form.reset(EMPTY_FORM)
      setPreview(null)
      setIsOpen(false)
      onAdded()
    },
  })

  function previewMatches() {
    setPreview(null)

    if (parseEmailPattern(pattern)) {
      countMatches({ pattern })
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger render={<Button />}>Block an address</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Block an email address</DialogTitle>
          <DialogDescription>
            A blocked pattern stops new account creation. It does not ban the accounts that
            already exist — ban those one at a time from the users list.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((values) => create(values))} className="space-y-5 pt-2">
            <FormField
              control={form.control}
              name="pattern"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pattern</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="*@example.com"
                      {...field}
                      onBlur={() => {
                        field.onBlur()
                        previewMatches()
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    <code>spam@example.com</code> blocks one address, <code>*@example.com</code> a
                    whole domain, and <code>*@*.example.com</code> that domain and every subdomain.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {preview ? (
              <p className="text-sm text-muted-foreground">
                {preview.count === 0 ? (
                  "No existing account matches this pattern."
                ) : (
                  <>
                    {preview.count} existing{" "}
                    {preview.count === 1 ? "account matches" : "accounts match"} this pattern. They
                    keep their access.{" "}
                    <Link
                      href={`${ADMIN_USERS_PATH}?email=${encodeURIComponent(preview.emailFilter)}`}
                      className="underline"
                    >
                      Review them
                    </Link>
                    .
                  </>
                )}
              </p>
            ) : null}

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Disposable address provider"
                      rows={2}
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormDescription>Staff-only. Nobody outside the panel sees it.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button type="submit" disabled={isExecuting}>
                {isExecuting ? "Adding..." : "Add to blocklist"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
