"use client";

import { valibotResolver } from "@hookform/resolvers/valibot";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { updateApiKeyScopesAction } from "@/actions/api-key-actions";
import { ScopePicker } from "@/components/api-keys/scope-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormField } from "@/components/ui/form";
import type { ApiKeySummary } from "@/lib/api-keys/api-keys";
import {
  updateApiKeyScopesSchema,
  type UpdateApiKeyScopesSchema,
} from "@/schemas/api-key.schema";

/**
 * Re-grants an existing key. The name and expiry stay fixed: re-scoping narrows or widens what a
 * live secret can do, while extending its life without re-issuing it is a different decision.
 */
export function EditApiKeyScopesDialog({ apiKey }: { apiKey: ApiKeySummary }) {
  const t = useTranslations("Client.Settings.ApiKeys");
  const tCommon = useTranslations("Client.Common");
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  // The summary already holds only the scopes the key can exercise, so saving an untouched form
  // repairs a key issued before account-only scopes were refused on a team key.
  const currentScopes = apiKey.scopes;

  const form = useForm<UpdateApiKeyScopesSchema>({
    resolver: valibotResolver(updateApiKeyScopesSchema),
    defaultValues: { keyId: apiKey.id, scopes: currentScopes },
  });

  const { execute, isExecuting } = useAction(updateApiKeyScopesAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message || t("toastUpdateScopesError"));
    },
    onSuccess: () => {
      toast.dismiss();
      toast.success(t("toastUpdateScopesSuccess"));
      setIsOpen(false);
      router.refresh();
    },
  });

  const selectedScopes = form.watch("scopes") ?? [];

  function openChange(open: boolean): void {
    setIsOpen(open);

    // Reopening starts from what the key holds now, not from an abandoned edit.
    if (!open) {
      form.reset({ keyId: apiKey.id, scopes: currentScopes });
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={openChange}>
      <DialogTrigger render={<Button size="sm" variant="outline" className="w-full sm:w-auto" />}>
        {t("editScopes")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("editScopesDialogTitle")}</DialogTitle>
          <DialogDescription>{t("editScopesDialogDescription")}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((values) => execute(values))} className="space-y-5 pt-2">
            <FormField
              control={form.control}
              name="scopes"
              render={() => (
                <ScopePicker
                  selectedScopes={selectedScopes}
                  teamId={apiKey.teamId}
                  onChange={(scopes) =>
                    form.setValue("scopes", scopes, { shouldValidate: true, shouldDirty: true })
                  }
                />
              )}
            />

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                {tCommon("cancel")}
              </DialogClose>
              <Button type="submit" disabled={isExecuting}>
                {isExecuting ? t("savingScopes") : t("saveScopes")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
