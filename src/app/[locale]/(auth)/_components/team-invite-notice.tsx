"use client";

import { useTranslations } from "@/i18n/client";
import { isTeamInviteRedirect } from "@/lib/teams/team-invite-links";

export function TeamInviteNotice({ redirectPath }: { redirectPath: string }) {
  const t = useTranslations("Client.Auth.TeamInvite");

  if (!isTeamInviteRedirect(redirectPath)) {
    return null;
  }

  return (
    <p className="mt-4 rounded-md border border-border bg-muted/50 p-3 text-sm text-foreground">
      {t("signInNotice")}
    </p>
  );
}
