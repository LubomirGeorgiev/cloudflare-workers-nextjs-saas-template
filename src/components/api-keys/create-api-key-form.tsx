"use client";

import { valibotResolver } from "@hookform/resolvers/valibot";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { createApiKeyAction } from "@/actions/api-key-actions";
import { ScopePicker } from "@/components/api-keys/scope-picker";
import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { API_KEY_EXPIRY_DAY_OPTIONS } from "@/constants";
import { createApiKeySchema, type CreateApiKeySchema } from "@/schemas/api-key.schema";

// Sentinel for the "never expires" option: a Select needs a non-empty string value, while the
// schema expects the field to be absent.
const NO_EXPIRY_VALUE = "never";

/** The dialog's first mode. Hands the minted secret up so the reveal can take over. */
export function CreateApiKeyForm({
  teamId,
  onCreated,
}: {
  teamId?: string;
  onCreated: (secret: string | null) => void;
}) {
  const t = useTranslations("Client.Settings.ApiKeys");
  const tCommon = useTranslations("Client.Common");
  const router = useRouter();

  const form = useForm<CreateApiKeySchema>({
    resolver: valibotResolver(createApiKeySchema),
    defaultValues: { name: "", scopes: [], teamId, expiresInDays: undefined },
  });

  const { execute, isExecuting } = useAction(createApiKeyAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message || t("toastCreateError"));
    },
    onSuccess: ({ data }) => {
      toast.dismiss();
      toast.success(t("toastCreateSuccess"));
      onCreated(data?.secret ?? null);
      form.reset({ name: "", scopes: [], teamId, expiresInDays: undefined });
      router.refresh();
    },
  });

  const selectedScopes = form.watch("scopes") ?? [];

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("createDialogTitle")}</DialogTitle>
        <DialogDescription>{t("createDialogDescription")}</DialogDescription>
      </DialogHeader>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((values) => execute({ ...values, teamId }))}
          className="space-y-5 pt-2"
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("nameLabel")}</FormLabel>
                <FormControl>
                  <Input placeholder={t("namePlaceholder")} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="scopes"
            render={() => (
              <ScopePicker
                selectedScopes={selectedScopes}
                teamId={teamId}
                onChange={(scopes) =>
                  form.setValue("scopes", scopes, { shouldValidate: true, shouldDirty: true })
                }
              />
            )}
          />

          <FormField
            control={form.control}
            name="expiresInDays"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("expiryLabel")}</FormLabel>
                <Select
                  value={field.value ? String(field.value) : NO_EXPIRY_VALUE}
                  onValueChange={(value) =>
                    field.onChange(value === NO_EXPIRY_VALUE ? undefined : Number(value))
                  }
                >
                  <FormControl>
                    <SelectTrigger aria-label={t("expiryLabel")}>
                      <SelectValue>
                        {(value: string | null) =>
                          value && value !== NO_EXPIRY_VALUE
                            ? t("expiryDays", { days: Number(value) })
                            : t("expiryNever")}
                      </SelectValue>
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={NO_EXPIRY_VALUE}>{t("expiryNever")}</SelectItem>
                    {API_KEY_EXPIRY_DAY_OPTIONS.map((days) => (
                      <SelectItem key={days} value={String(days)}>
                        {t("expiryDays", { days })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {tCommon("cancel")}
            </DialogClose>
            <Button type="submit" disabled={isExecuting}>
              {t("createButton")}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  );
}
