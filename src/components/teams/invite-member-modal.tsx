"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "next-safe-action/hooks";
import { inviteUserAction } from "@/actions/team-membership-actions";
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
import { inviteMemberFormSchema, type InviteMemberFormSchema } from "@/schemas/team-membership.schema";
import { useTranslations } from "@/i18n/client";
import { Link } from "@/i18n/navigation";
import type { TeamSeatUsage } from "@/lib/teams/team-seats";
import { useRouter } from "next/navigation";

type FormValues = InviteMemberFormSchema;

interface InviteMemberModalProps {
  teamId: string;
  trigger: React.ReactElement;
  seatUsage: TeamSeatUsage;
  // The team billing page; absent when billing is off or the viewer cannot open it.
  upgradeHref?: string;
  onInviteSuccess?: () => void;
}

export function InviteMemberModal({ teamId, trigger, seatUsage, upgradeHref, onInviteSuccess }: InviteMemberModalProps) {
  const t = useTranslations("Client.Dashboard.Teams");
  const tCommon = useTranslations("Client.Common");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Initialize react-hook-form
  const form = useForm<FormValues>({
    resolver: valibotResolver(inviteMemberFormSchema),
    defaultValues: {
      email: ""
    }
  });

  const { execute, isExecuting } = useAction(inviteUserAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message || t("toastInviteError"));
      console.error("Invite error:", error);
    },
    onExecute: () => {
      toast.loading(t("toastSendingInvite"));
    },
    onSuccess: () => {
      toast.dismiss();
      toast.success(t("toastInviteSuccess"));
      form.reset();
      router.refresh();

      if (onInviteSuccess) {
        onInviteSuccess();
      }

      // Close the modal after a short delay
      setTimeout(() => {
        setOpen(false);
      }, 1500);
    }
  });

  const onSubmit = async (data: FormValues) => {
    execute({
      teamId,
      email: data.email,
      roleId: "member", // Default role
      isSystemRole: true
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("inviteModalTitle")}</DialogTitle>
          <DialogDescription>
            {t("seatUsage", {
              used: seatUsage.used,
              limit: seatUsage.limit,
              members: seatUsage.activeMembers,
              pending: seatUsage.pendingInvitations,
            })}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form method="post" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
            {/* Keep the form when full: the service resends a pending invitation without a seat check. */}
            {seatUsage.isFull && (
              <div className="space-y-2 rounded-md border p-3 text-sm">
                <p>
                  {t("seatLimitNotice", {
                    used: seatUsage.used,
                    limit: seatUsage.limit,
                    pending: seatUsage.pendingInvitations,
                  })}
                </p>
                <p className="text-muted-foreground">{t("seatLimitResendHint")}</p>
                {upgradeHref && (
                  // Close first: the team page stays mounted, so browser Back would show the dialog again.
                  <Link
                    href={upgradeHref}
                    className={buttonVariants({ size: "sm" })}
                    onClick={() => setOpen(false)}
                  >
                    {t("upgradePlan")}
                  </Link>
                )}
              </div>
            )}

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("inviteEmailLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder={t("inviteEmailPlaceholder")}
                      {...field}
                    />
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

              <Button type="submit" disabled={isExecuting}>
                {t("sendInvitation")}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
