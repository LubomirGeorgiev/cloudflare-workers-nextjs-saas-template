"use client";

import { valibotResolver } from "@hookform/resolvers/valibot";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { createApiKeyAction } from "@/actions/api-key-actions";
import { ApiKeyExpirySelect } from "@/components/api-keys/api-key-expiry-select";
import { ScopePicker, useApiScopeOptions } from "@/components/api-keys/scope-picker";
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
import { createApiKeySchema, type CreateApiKeySchema } from "@/schemas/api-key.schema";

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
  const scopeOptions = useApiScopeOptions({ teamId });

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
                options={scopeOptions}
                selectedScopes={selectedScopes}
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
                <ApiKeyExpirySelect
                  value={field.value}
                  onChange={field.onChange}
                  label={t("expiryLabel")}
                  neverLabel={t("expiryNever")}
                  formatDays={(days) => t("expiryDays", { days })}
                />
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
