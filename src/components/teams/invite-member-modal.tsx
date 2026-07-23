"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { requiredString, v, validationKey } from "@/lib/validation";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

// Define the form schema with validation
const formSchema = v.object({
  email: v.pipe(requiredString(validationKey("emailRequired")), v.email(validationKey("invalidEmail")))
});

type FormValues = v.InferOutput<typeof formSchema>;

interface InviteMemberModalProps {
  teamId: string;
  trigger: React.ReactElement;
  onInviteSuccess?: () => void;
}

export function InviteMemberModal({ teamId, trigger, onInviteSuccess }: InviteMemberModalProps) {
  const t = useTranslations("Client.Dashboard.Teams");
  const tCommon = useTranslations("Client.Common");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Initialize react-hook-form
  const form = useForm<FormValues>({
    resolver: valibotResolver(formSchema),
    defaultValues: {
      email: ""
    }
  });

  const { execute } = useAction(inviteUserAction, {
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
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
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

              <Button type="submit">
                {t("sendInvitation")}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
