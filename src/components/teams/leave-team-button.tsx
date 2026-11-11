"use client";

import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

import { leaveTeamAction } from "@/actions/team-membership-actions";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { Button } from "@/components/ui/button";
import { TEAMS_DASHBOARD_PATH } from "@/constants";
import { useFetchSession } from "@/hooks/use-fetch-session";
import { useTranslations } from "@/i18n/client";
import { useRouter } from "@/i18n/navigation";

export function LeaveTeamButton({ teamId, teamName }: { teamId: string; teamName: string }) {
  const t = useTranslations("Client.Dashboard.Teams");
  const router = useRouter();
  const fetchSession = useFetchSession();

  const { executeAsync: leave } = useAction(leaveTeamAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || t("toastLeaveError"));
    },
    onSuccess: () => {
      toast.success(t("toastLeaveSuccess"));
      // Vinext skips refresh() while a push is pending, so the layout keeps the old session.
      // The sidebar reads the store first, so load the store again from the server.
      void fetchSession({ reason: "mutation" });
      router.push(TEAMS_DASHBOARD_PATH);
      router.refresh();
    },
  });

  return (
    <ConfirmDestructiveDialog
      trigger={<Button variant="outline" />}
      triggerLabel={t("leaveTeam")}
      title={t("leaveTeamTitle", { name: teamName })}
      description={t("leaveTeamDescription")}
      confirmLabel={t("leaveTeam")}
      pendingLabel={t("leaving")}
      onConfirm={() => leave({ teamId })}
    />
  );
}
