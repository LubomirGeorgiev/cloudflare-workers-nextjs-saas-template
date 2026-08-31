"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SYSTEM_ROLES_ENUM } from "@/db/schema";

/** The two fields the owner test reads, so both admin membership rows satisfy it. */
interface RemovableMembership {
  roleId: string;
  isSystemRole: boolean;
}

interface RemoveTeamMemberControlProps {
  member: RemovableMembership;
  /** The trigger, the confirm button, and the disabled owner button all show this one label. */
  removeLabel: string;
  /** Replaces `removeLabel` while the action runs. */
  pendingLabel: string;
  title: string;
  description: ReactNode;
  /** Return the action's promise (`executeAsync`) so the dialog can show progress. */
  onRemove: () => Promise<unknown>;
}

// One remove-member control for both admin pages. They differ only in their copy and in which
// action they call, which is why those are props: the owner test, the tooltip that explains the
// refusal, and the confirm dialog are the same control on both.
export function RemoveTeamMemberControl({
  member,
  removeLabel,
  pendingLabel,
  title,
  description,
  onRemove,
}: RemoveTeamMemberControlProps) {
  // Role copy only: the rest of the admin surface is deliberately English, but this key already
  // exists in every catalog for the team dashboard.
  const tTeams = useTranslations("Client.Dashboard.Teams");
  // The service refuses it too; disabling the control is what explains why.
  const isOwner = member.isSystemRole && member.roleId === SYSTEM_ROLES_ENUM.OWNER;

  if (isOwner) {
    return (
      <Tooltip>
        <TooltipTrigger render={<span />}>
          <Button size="sm" variant="destructive" disabled>
            {removeLabel}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tTeams("ownerCannotBeRemoved")}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <ConfirmDestructiveDialog
      trigger={<Button size="sm" variant="destructive" />}
      triggerLabel={removeLabel}
      title={title}
      description={description}
      confirmLabel={removeLabel}
      pendingLabel={pendingLabel}
      onConfirm={onRemove}
    />
  );
}
