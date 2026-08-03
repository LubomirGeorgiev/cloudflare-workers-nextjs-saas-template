"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { TrashIcon } from "lucide-react";
import { toast } from "sonner";

import { revokeTeamInvitationAction } from "@/actions/team-membership-actions";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { Button } from "@/components/ui/button";
import type { RevokeTeamInvitationSchema } from "@/schemas/team-membership.schema";

interface RevokeInvitationButtonProps extends RevokeTeamInvitationSchema {
  email: string;
}

export function RevokeInvitationButton({
  email,
  invitationId,
  teamId,
}: RevokeInvitationButtonProps) {
  const t = useTranslations("Client.Dashboard.Teams");
  const router = useRouter();

  const { executeAsync: revokeInvitation } = useAction(revokeTeamInvitationAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || t("toastRevokeInvitationError"));
    },
    onSuccess: () => {
      toast.success(t("toastRevokeInvitationSuccess"));
      router.refresh();
    },
  });

  return (
    <ConfirmDestructiveDialog
      trigger={
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
        />
      }
      triggerLabel={
        <>
          <TrashIcon className="h-4 w-4" />
          <span className="sr-only">{t("revokeInvitationFor", { email })}</span>
        </>
      }
      title={t("revokeInvitationTitle")}
      description={t("revokeInvitationDescription", { email })}
      confirmLabel={t("revokeInvitation")}
      pendingLabel={t("revokingInvitation")}
      onConfirm={() => revokeInvitation({ teamId, invitationId })}
    />
  );
}
