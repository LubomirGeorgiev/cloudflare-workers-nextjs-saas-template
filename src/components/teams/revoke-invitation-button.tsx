"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { TrashIcon } from "lucide-react";
import { toast } from "sonner";

import { revokeTeamInvitationAction } from "@/actions/team-membership-actions";
import { Button } from "@/components/ui/button";
import type { RevokeTeamInvitationSchema } from "@/schemas/team-invitation.schema";
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

interface RevokeInvitationButtonProps extends RevokeTeamInvitationSchema {
  email: string;
}

export function RevokeInvitationButton({
  email,
  invitationId,
  teamId,
}: RevokeInvitationButtonProps) {
  const t = useTranslations("Client.Dashboard.Teams");
  const tCommon = useTranslations("Client.Common");
  const dialogCloseRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  const { execute: revokeInvitation, isExecuting } = useAction(revokeTeamInvitationAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || t("toastRevokeInvitationError"));
      dialogCloseRef.current?.click();
    },
    onSuccess: () => {
      toast.success(t("toastRevokeInvitationSuccess"));
      router.refresh();
      dialogCloseRef.current?.click();
    },
  });

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
          />
        }
      >
        <TrashIcon className="h-4 w-4" />
        <span className="sr-only">{t("revokeInvitationFor", { email })}</span>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("revokeInvitationTitle")}</DialogTitle>
          <DialogDescription>
            {t("revokeInvitationDescription", { email })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4 flex flex-col gap-4 sm:flex-row">
          <DialogClose
            ref={dialogCloseRef}
            render={<Button variant="outline" className="sm:w-auto w-full" />}
          >
            {tCommon("cancel")}
          </DialogClose>
          <Button
            variant="destructive"
            onClick={() => revokeInvitation({ teamId, invitationId })}
            disabled={isExecuting}
            className="sm:w-auto w-full"
          >
            {isExecuting ? t("revokingInvitation") : t("revokeInvitation")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
