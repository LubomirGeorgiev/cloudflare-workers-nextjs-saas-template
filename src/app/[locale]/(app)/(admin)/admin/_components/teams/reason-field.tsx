"use client"

import { useFormContext, type FieldValues, type UseFormReturn } from "react-hook-form"
import { toast } from "sonner"

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Textarea } from "@/components/ui/textarea"

/** The required staff reason of a team action. It reads the `reason` field of the enclosing `<Form>`. */
export function ReasonField({ placeholder, description }: { placeholder: string; description: string }) {
  const { control } = useFormContext<{ reason: string }>()

  return (
    <FormField
      control={control}
      name="reason"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Reason</FormLabel>
          <FormControl>
            <Textarea placeholder={placeholder} rows={2} {...field} />
          </FormControl>
          <FormDescription>{description}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

/** The `useAction` callbacks of a saved staff change. The reason clears: each change needs its own. */
export function reasonFormCallbacks<Values extends FieldValues & { reason: string }>({
  form,
  successMessage,
  errorMessage,
}: {
  form: UseFormReturn<Values>
  successMessage: string
  errorMessage: string
}) {
  return {
    onError: ({ error }: { error: { serverError?: { message: string } } }) => {
      toast.error(error.serverError?.message || errorMessage)
    },
    onSuccess: () => {
      toast.success(successMessage)
      form.reset({ ...form.getValues(), reason: "" })
    },
  }
}
