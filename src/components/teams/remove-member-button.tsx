"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { useRef } from "react";
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
  tooltipText = "You cannot remove this member"
}: RemoveMemberButtonProps) {
  const dialogCloseRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  const { execute: removeMember, isExecuting } = useAction(removeTeamMemberAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to remove team member");
      dialogCloseRef.current?.click();
    },
    onSuccess: () => {
      toast.success("Team member removed successfully");
      router.refresh();
      dialogCloseRef.current?.click();
    }
  });

  const handleRemoveMember = () => {
    removeMember({ teamId, userId });
  };

  // If the button is disabled, wrap it in a tooltip
  if (isDisabled) {
    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground cursor-not-allowed opacity-50"
                disabled
            >
              <TrashIcon className="h-4 w-4" />
              <span className="sr-only">Cannot remove member</span>
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={5} className="text-sm font-medium">
            {tooltipText}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
        >
          <TrashIcon className="h-4 w-4" />
          <span className="sr-only">Remove member</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove team member</DialogTitle>
          <DialogDescription>
            Are you sure you want to remove {memberName} from this team? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4 flex flex-col gap-4 sm:flex-row">
          <DialogClose ref={dialogCloseRef} asChild>
            <Button variant="outline" className="sm:w-auto w-full">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={handleRemoveMember}
            disabled={isExecuting}
            className="sm:w-auto w-full"
          >
            {isExecuting ? "Removing..." : "Remove member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
