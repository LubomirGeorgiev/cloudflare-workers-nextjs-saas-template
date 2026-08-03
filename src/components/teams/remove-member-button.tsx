"use client";

import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { removeTeamMemberAction } from "@/actions/team-membership-actions";
import { TrashIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAction } from "next-safe-action/hooks";
import { useTranslations } from "next-intl";

interface RemoveMemberButtonProps {
  teamId: string;
  userId: string;
  memberName: string;
  isDisabled?: boolean;
  tooltipText?: string;
}

export function RemoveMemberButton({
  teamId,
  userId,
  memberName,
  isDisabled = false,
  tooltipText,
}: RemoveMemberButtonProps) {
  const t = useTranslations("Client.Dashboard.Teams");
  const resolvedTooltipText = tooltipText ?? t("cannotRemoveTooltip");
  const router = useRouter();

  const { executeAsync: removeMember } = useAction(removeTeamMemberAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || t("toastRemoveError"));
    },
    onSuccess: () => {
      toast.success(t("toastRemoveSuccess"));
      router.refresh();
    }
  });

  // If the button is disabled, wrap it in a tooltip
  if (isDisabled) {
    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger
            render={<div />}
          >
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground cursor-not-allowed opacity-50"
                disabled
            >
              <TrashIcon className="h-4 w-4" />
              <span className="sr-only">{t("cannotRemoveMember")}</span>
              </Button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={5} className="text-sm font-medium">
            {resolvedTooltipText}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

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
          <span className="sr-only">{t("removeMember")}</span>
        </>
      }
      title={t("removeMemberTitle")}
      description={t("removeMemberDescription", { name: memberName })}
      confirmLabel={t("removeMember")}
      pendingLabel={t("removing")}
      onConfirm={() => removeMember({ teamId, userId })}
    />
  );
}
