"use client"

import type { Control, FieldValues, Path } from "react-hook-form"

import { Checkbox } from "@/components/ui/checkbox"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Textarea } from "@/components/ui/textarea"

// The three controls a ban and an unban both take, in the same order, rendered once.
// `banDecisionFields` declares the decision in one place; this is its form half, so the two
// dialogs cannot drift apart in wording either.
//
// The labels carry the whole distinction between the two reasons. Two boxes with vague labels
// would be worse than one box with a warning, so they are part of the design, not decoration.

interface BanDecisionFieldsProps<TValues extends FieldValues> {
  control: Control<TValues>
  /** True while "email the user" is checked; the external reason is disabled otherwise. */
  sendEmail: boolean
  /** False when the account has no address on file: both notice controls go dead. */
  hasEmail: boolean
  internalReasonPlaceholder: string
  externalReasonPlaceholder: string
  sendEmailLabel: string
  /** What the notice is for, shown under the checkbox when an address exists. */
  sendEmailDescription: string
}

export function BanDecisionFields<TValues extends FieldValues>({
  control,
  sendEmail,
  hasEmail,
  internalReasonPlaceholder,
  externalReasonPlaceholder,
  sendEmailLabel,
  sendEmailDescription,
}: BanDecisionFieldsProps<TValues>) {
  return (
    <>
      <FormField
        control={control}
        name={"internalReason" as Path<TValues>}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Internal reason</FormLabel>
            <FormControl>
              <Textarea placeholder={internalReasonPlaceholder} rows={2} {...field} />
            </FormControl>
            <FormDescription>Staff only, never sent to the user.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name={"sendEmail" as Path<TValues>}
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
              <FormLabel>{sendEmailLabel}</FormLabel>
              <FormDescription>
                {hasEmail ? sendEmailDescription : "No email address on file, so no notice can be sent."}
              </FormDescription>
            </div>
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name={"externalReason" as Path<TValues>}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Reason to send the user (optional)</FormLabel>
            <FormControl>
              <Textarea
                rows={2}
                disabled={!sendEmail || !hasEmail}
                placeholder={externalReasonPlaceholder}
                {...field}
                value={field.value ?? ""}
              />
            </FormControl>
            <FormDescription>
              This exact text appears in the email. Leave it blank to send the notice without a
              reason.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  )
}
