"use client"

import { Loader2, Trash2 } from "lucide-react"
import { useAction } from "next-safe-action/hooks"
import { useState } from "react"
import { toast } from "sonner"

import { purgeVinextCacheAction } from "@/app/(admin)/admin/debug/debug.actions"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { VINEXT_CACHE_PREFIX } from "@/constants/vinext-cache"

export function PurgeVinextCacheButton() {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const { execute, isExecuting } = useAction(purgeVinextCacheAction, {
    onSuccess: ({ data }) => {
      toast.success(data?.message ?? "Vinext KV cache cleared")
      setIsConfirmOpen(false)
    },
    onError: ({ error }) => {
      toast.error(error.serverError?.message ?? "Failed to clear Vinext KV cache")
    },
  })

  return (
    <>
      <Button variant="destructive" onClick={() => setIsConfirmOpen(true)}>
        <Trash2 aria-hidden="true" />
        Nuke Vinext KV cache
      </Button>
      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nuke the entire Vinext KV cache?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every KV key matching{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
                {VINEXT_CACHE_PREFIX}*
              </code>
              . Cached pages and data will be rebuilt as they are requested.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isExecuting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isExecuting}
              onClick={() => execute()}
              className={buttonVariants({ variant: "destructive" })}
            >
              {isExecuting ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {isExecuting ? "Deleting…" : "Delete all cache keys"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
