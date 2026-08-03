"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
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

interface ConfirmDestructiveDialogProps {
  /** The button shell that opens the dialog: callers own its variant, size, and classes. */
  trigger: ReactElement;
  /** What renders inside the trigger — a label, or an icon plus its screen-reader text. */
  triggerLabel: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** Replaces `confirmLabel` while the action runs. */
  pendingLabel: string;
  /**
   * Return the action's promise (`executeAsync`, not `execute`) so the dialog can show progress.
   * It closes once the action settles either way — success and failure both report by toast, and a
   * modal left open over a finished action is the worse of the two failure modes.
   */
  onConfirm: () => void | Promise<unknown>;
}

// The canonical "are you sure?" for an irreversible action. Hand-rolling this block is how the
// codebase ended up with five near-identical copies; add a prop here rather than a sixth.
export function ConfirmDestructiveDialog({
  trigger,
  triggerLabel,
  title,
  description,
  confirmLabel,
  pendingLabel,
  onConfirm,
}: ConfirmDestructiveDialogProps) {
  const tCommon = useTranslations("Client.Common");
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  async function confirm() {
    setIsPending(true);

    try {
      await onConfirm();
    } finally {
      setIsPending(false);
      setIsOpen(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger render={trigger}>{triggerLabel}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4 flex-col gap-4 sm:mt-0 sm:flex-row sm:gap-0">
          <DialogClose
            render={<Button variant="outline" className="w-full sm:w-auto" />}
            disabled={isPending}
          >
            {tCommon("cancel")}
          </DialogClose>
          <Button
            variant="destructive"
            onClick={confirm}
            disabled={isPending}
            className="w-full sm:w-auto"
          >
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
