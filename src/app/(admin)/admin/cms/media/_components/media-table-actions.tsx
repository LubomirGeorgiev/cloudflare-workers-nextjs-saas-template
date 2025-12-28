"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useServerAction } from "zsa-react";
import { deleteCmsMediaAction } from "@/app/(admin)/admin/_actions/cms-media-actions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface MediaTableActionsProps {
  mediaId: string;
  usageCount: number;
}

export function MediaTableActions({ mediaId, usageCount }: MediaTableActionsProps) {
  const router = useRouter();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { execute: deleteMedia, isPending } = useServerAction(deleteCmsMediaAction, {
    onError: (error) => {
      toast.error(error.err?.message || "Failed to delete media");
    },
    onSuccess: () => {
      toast.success("Media deleted successfully");
      setShowDeleteDialog(false);
      router.refresh();
    },
  });

  const handleDelete = async () => {
    await deleteMedia({ mediaId });
  };

  const isDisabled = usageCount > 0 || isPending;

  return (
    <>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="inline-flex">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowDeleteDialog(true)}
                disabled={isDisabled}
                style={isDisabled ? { pointerEvents: 'none' } : undefined}
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {usageCount > 0 ? (
              <p>Cannot delete: Used in {usageCount} {usageCount === 1 ? "entry" : "entries"}</p>
            ) : (
              <p>Delete this media file</p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Media File</AlertDialogTitle>
            <AlertDialogDescription>
              {usageCount > 0 ? (
                <>
                  This media file is currently used in {usageCount}{" "}
                  {usageCount === 1 ? "entry" : "entries"}. Remove it from all entries before
                  deleting.
                </>
              ) : (
                <>
                  Are you sure you want to delete this media file? This action cannot be undone
                  and the file will be permanently removed from storage.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            {usageCount === 0 && (
              <AlertDialogAction onClick={handleDelete} disabled={isPending}>
                {isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
