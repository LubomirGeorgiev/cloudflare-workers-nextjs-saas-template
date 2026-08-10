"use client";

import { Database, Globe, Loader2, RefreshCw, Search, Trash2, Zap } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { runCmsSystemAction } from "@/app/[locale]/(app)/(admin)/admin/_actions/cms-system-actions";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VINEXT_CACHE_PREFIX } from "@/constants/vinext-cache";
import { cn } from "@/lib/utils";

type ActionKey =
  | "rebuild-all"
  | "clear-search-cache-all"
  | "clear-cms-cache"
  | "purge-vinext-kv-cache"
  | "purge-workers-cdn-cache";

type CmsSystemActionInput = NonNullable<Parameters<typeof runCmsSystemAction>[0]>;

interface PendingConfirm {
  key: ActionKey;
  input: CmsSystemActionInput;
  title: string;
  description: string;
  destructive?: boolean;
}

const GLOBAL_ACTIONS = [
  {
    key: "rebuild-all" as ActionKey,
    icon: Search,
    title: "Rebuild All Search Indexes",
    description:
      "Rebuilds search indexes for all searchable collections. Run this after bulk content changes.",
    variant: "outline" as const,
    confirm: {
      input: { type: "rebuild-search-index" } satisfies CmsSystemActionInput,
      title: "Rebuild all search indexes?",
      description:
        "This rebuilds search indexes for every searchable collection. It can take a moment after large content updates.",
    },
  },
  {
    key: "clear-search-cache-all" as ActionKey,
    icon: RefreshCw,
    title: "Clear Search Cache",
    description:
      "Removes cached search results for all collections. New queries will re-run against the index.",
    variant: "outline" as const,
    confirm: {
      input: { type: "clear-search-cache" } satisfies CmsSystemActionInput,
      title: "Clear search cache for all collections?",
      description:
        "Cached search results will be removed. The next searches will read fresh data from the indexes.",
    },
  },
  {
    key: "clear-cms-cache" as ActionKey,
    icon: Database,
    title: "Clear CMS Cache",
    description:
      "Revalidates cached CMS content. Pages will re-fetch from the database on the next request.",
    variant: "outline" as const,
    confirm: {
      input: { type: "clear-cms-cache" } satisfies CmsSystemActionInput,
      title: "Clear all CMS cache?",
      description:
        "Cached CMS content will be revalidated. Traffic may briefly hit the database until caches warm again.",
    },
  },
  {
    key: "purge-vinext-kv-cache" as ActionKey,
    icon: Trash2,
    title: "Purge Vinext KV Cache",
    description:
      "Deletes every Vinext data-cache key in KV. Cached fetch / use-cache entries rebuild on demand.",
    variant: "destructive" as const,
    confirm: {
      input: { type: "purge-vinext-kv-cache" } satisfies CmsSystemActionInput,
      title: "Purge the entire Vinext KV cache?",
      description: `This permanently deletes every KV key matching ${VINEXT_CACHE_PREFIX}*. Cached pages and data will be rebuilt as they are requested.`,
      destructive: true,
    },
  },
  {
    key: "purge-workers-cdn-cache" as ActionKey,
    icon: Globe,
    title: "Purge Workers CDN Cache",
    description:
      "Calls Workers Cache purgeEverything. Edge-cached HTML, RSC, and route responses are dropped globally.",
    variant: "destructive" as const,
    confirm: {
      input: { type: "purge-workers-cdn-cache" } satisfies CmsSystemActionInput,
      title: "Purge the entire Workers CDN cache?",
      description:
        "This invalidates every response stored in this Worker's CDN cache. Traffic will miss until pages warm again. Unavailable outside Workers Cache.",
      destructive: true,
    },
  },
] as const;

export function CmsSystemActions() {
  const [activeAction, setActiveAction] = useState<ActionKey | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const { execute } = useAction(runCmsSystemAction, {
    onSuccess: ({ data }) => {
      toast.success(data?.message || "CMS maintenance task completed");
      setActiveAction(null);
    },
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "CMS maintenance task failed");
      setActiveAction(null);
    },
  });

  function handleAction(key: ActionKey, params: Parameters<typeof execute>[0]) {
    setActiveAction(key);
    void execute(params);
  }

  function confirmPending() {
    if (!pendingConfirm) {
      return;
    }
    const { key, input } = pendingConfirm;
    setPendingConfirm(null);
    handleAction(key, input);
  }

  const isAnyExecuting = activeAction !== null;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-primary/10 rounded-md shrink-0">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle>System Actions</CardTitle>
              <CardDescription>
                Maintenance tasks for CMS search indexes, data cache, and Workers CDN cache.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {GLOBAL_ACTIONS.map(({ key, icon: Icon, title, description, variant, confirm }) => (
              <div key={key} className="rounded-lg border p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-1.5 bg-muted rounded-md mt-0.5 shrink-0">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium leading-tight">{title}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {description}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={variant}
                  disabled={isAnyExecuting}
                  className="w-full mt-auto"
                  onClick={() =>
                    setPendingConfirm({
                      key,
                      input: confirm.input,
                      title: confirm.title,
                      description: confirm.description,
                      destructive: "destructive" in confirm && confirm.destructive,
                    })
                  }
                >
                  {activeAction === key ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                  {activeAction === key ? "Running…" : "Run"}
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={pendingConfirm !== null}
        onOpenChange={(open) => !open && setPendingConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingConfirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pendingConfirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isAnyExecuting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmPending}
              disabled={isAnyExecuting}
              className={cn(
                pendingConfirm?.destructive && buttonVariants({ variant: "destructive" }),
              )}
            >
              {isAnyExecuting ? "Running…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
