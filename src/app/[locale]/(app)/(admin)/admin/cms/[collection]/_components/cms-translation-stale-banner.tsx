"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  markTranslationReviewedAction,
  retranslateTranslationAction,
} from "../../../_actions/cms-entry-actions";
import type { TranslatableEntryField } from "@/types/cms";

const FIELD_LABELS: Record<TranslatableEntryField, string> = {
  title: "title",
  seoDescription: "SEO description",
  content: "content",
};

// Editor banner shown when the entry being edited is a translation whose source has
// drifted. Offers a one-click re-translate (pulls the latest for the changed fields)
// and a "mark up to date" escape hatch for translations reconciled by hand.
export function CmsTranslationStaleBanner({
  entryId,
  staleFields,
}: {
  entryId: string;
  staleFields: TranslatableEntryField[];
}) {
  const router = useRouter();

  // Both actions revalidate the route, which unmounts this banner (isStale flips to
  // false) — so we drive the result off executeAsync in the handler rather than an
  // onSuccess effect, which would never fire on an unmounted component.
  const { executeAsync: retranslate, isExecuting: isRetranslating } = useAction(
    retranslateTranslationAction
  );
  const { executeAsync: markReviewed, isExecuting: isMarking } = useAction(
    markTranslationReviewedAction
  );

  const isBusy = isRetranslating || isMarking;
  const fieldList = staleFields.map((field) => FIELD_LABELS[field]).join(", ");

  const handleRetranslate = async () => {
    const toastId = toast.loading("Re-translating…");
    try {
      const result = await retranslate({ id: entryId });
      if (result?.data) {
        // The row's content changed server-side. A soft refresh won't re-seed the
        // form's defaultValues or the TipTap editor, so hard-reload to show the
        // fresh translation (the reload clears this loading toast).
        window.location.reload();
        return;
      }
      toast.error(result?.serverError?.message || "Failed to re-translate", { id: toastId });
    } catch {
      toast.error("Failed to re-translate", { id: toastId });
    }
  };

  const handleMarkReviewed = async () => {
    const toastId = toast.loading("Updating…");
    try {
      const result = await markReviewed({ id: entryId });
      if (result?.data) {
        toast.success("Marked as up to date", { id: toastId });
        // No content change — a soft refresh just drops the banner and preserves any
        // unsaved edits in the form.
        router.refresh();
        return;
      }
      toast.error(result?.serverError?.message || "Failed to update", { id: toastId });
    } catch {
      toast.error("Failed to update", { id: toastId });
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 sm:flex-row sm:items-center dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <AlertTriangle className="h-5 w-5 shrink-0" />
      <div className="flex-1 text-sm">
        <p className="font-medium">This translation is out of date</p>
        <p className="text-amber-800/80 dark:text-amber-200/70">
          The source content changed since this was translated
          {fieldList ? ` (${fieldList})` : ""}. Re-translate to pull the latest, or
          mark it up to date if you&apos;ve already handled it.
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 border-amber-400 bg-white/60 hover:bg-white dark:bg-transparent"
          disabled={isBusy}
          onClick={handleRetranslate}
        >
          {isRetranslating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Re-translate
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5 hover:bg-amber-100 dark:hover:bg-amber-500/20"
          disabled={isBusy}
          onClick={handleMarkReviewed}
        >
          {isMarking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Mark up to date
        </Button>
      </div>
    </div>
  );
}
