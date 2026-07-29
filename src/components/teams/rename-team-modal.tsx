"use client";

import { useState } from "react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "next-safe-action/hooks";
import { renameTeamAction } from "@/actions/team-actions";
import { useForm } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { toast } from "sonner";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { renameTeamSchema, type RenameTeamSchema } from "@/schemas/team.schema";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

interface RenameTeamModalProps {
  teamId: string;
  currentName: string;
  trigger: React.ReactElement;
}

export function RenameTeamModal({ teamId, currentName, trigger }: RenameTeamModalProps) {
  const t = useTranslations("Client.Dashboard.Teams");
  const tCommon = useTranslations("Client.Common");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const form = useForm<RenameTeamSchema>({
    resolver: valibotResolver(renameTeamSchema),
    defaultValues: {
      teamId,
      name: currentName,
    },
  });

  const { execute, isExecuting } = useAction(renameTeamAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message || t("toastRenameError"));
    },
    onExecute: () => {
      toast.loading(t("toastRenaming"));
    },
    onSuccess: ({ data }) => {
      toast.dismiss();
      toast.success(t("toastRenameSuccess"));

      // Reset to the persisted name so reopening the dialog shows the new value.
      form.reset({ teamId, name: data?.data?.name ?? currentName });
      router.refresh();
      setOpen(false);
    },
  });

  const nextName = form.watch("name")?.trim() ?? "";
  const isUnchanged = nextName === currentName.trim();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("renameModalTitle")}</DialogTitle>
          <DialogDescription>{t("renameModalUrlNote")}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((values) => execute(values))} className="space-y-4 pt-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("renameNameLabel")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("formNamePlaceholder")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-2">
              <DialogClose
                render={<Button type="button" variant="outline" />}
              >
                {tCommon("cancel")}
              </DialogClose>

              <Button type="submit" disabled={isExecuting || isUnchanged}>
                {t("renameTeam")}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
