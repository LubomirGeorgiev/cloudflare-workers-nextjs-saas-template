"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import { ZONE_PURGE_MISSING_TITLE } from "@/app/[locale]/(app)/(admin)/admin/_components/zone-purge-missing-alert";
import {
  EDGE_HTML_CACHE_TTL_MINUTES,
  EDGE_HTML_CACHE_ZONE_PURGED_TTL_MINUTES,
} from "@/constants/cache-control";
import {
  CMS_PURGE_STATUS,
  type CmsCachePurgeOutcome,
  type CmsPurgeStatus,
} from "@/constants/cache-purge";

// One id, so that a run of saves shows one warning and not a stack of copies.
const CMS_PURGE_WARNING_TOAST_ID = "cms-zone-purge-missing";
const CMS_PURGE_WARNING_DURATION_MS = 6000;
const RELOAD_TOAST_STORAGE_KEY = "cms-write-reload-toast";

/** The Toaster sits top-right, over the Save and Status controls of the entry form. */
export const CMS_WRITE_TOAST_POSITION = "bottom-right";

/** Rendered once by the CMS layout: the page after `reloadAfterCmsWrite` shows the toasts the reload dropped. */
export function CmsWriteReloadToast() {
  useEffect(() => {
    const reloadToast = takeReloadToast({
      storage: window.sessionStorage,
      pageLoadId: getPageLoadId(),
    });

    if (reloadToast !== null) {
      toast.success(reloadToast.successMessage, { position: CMS_WRITE_TOAST_POSITION });
      warnAfterCmsWrite({ cachePurge: reloadToast.cachePurge });
    }
  }, []);

  return null;
}

/**
 * Call after the success toast of every CMS write that purges caches. Pass the action result: its
 * `cachePurge` comes from `withCmsCachePurgeReport`.
 */
export function warnAfterCmsWrite(write?: CmsWriteResult): void {
  const warning = selectCmsPurgeWarning(write?.cachePurge);

  if (warning === null) {
    return;
  }

  toast.warning(CMS_PURGE_WARNING_COPY[warning].title, {
    id: CMS_PURGE_WARNING_TOAST_ID,
    description: CMS_PURGE_WARNING_COPY[warning].description,
    duration: CMS_PURGE_WARNING_DURATION_MS,
    position: CMS_WRITE_TOAST_POSITION,
  });
}

/**
 * For a CMS write that must reload the page, because a refresh does not re-seed the editor form.
 * A reload drops every toast, so the next page shows the success toast and the purge warning.
 */
export function reloadAfterCmsWrite({
  successMessage,
  write,
}: {
  successMessage: string;
  write?: CmsWriteResult;
}): void {
  stashReloadToast({
    storage: window.sessionStorage,
    pageLoadId: getPageLoadId(),
    reloadToast: { successMessage, cachePurge: write?.cachePurge },
  });
  window.location.reload();
}

/** The one warning a write shows. A failure goes first, because a retry can fix it now. */
export function selectCmsPurgeWarning(cachePurge?: CmsCachePurgeOutcome): CmsPurgeWarning | null {
  if (cachePurge?.zone === CMS_PURGE_STATUS.FAILED) {
    return CMS_PURGE_WARNING.ZONE_FAILED;
  }

  if (cachePurge?.workersCache === CMS_PURGE_STATUS.FAILED) {
    return CMS_PURGE_WARNING.WORKERS_CACHE_FAILED;
  }

  if (cachePurge?.zone === CMS_PURGE_STATUS.UNCONFIGURED) {
    return CMS_PURGE_WARNING.ZONE_UNCONFIGURED;
  }

  return null;
}

// A reload makes a new document, so its time origin differs from the page that stashed the toast.
function getPageLoadId(): string {
  return String(window.performance.timeOrigin);
}

// Storage can throw (a blocked or full store). A lost toast must never block the reload.
export function stashReloadToast({
  storage,
  pageLoadId,
  reloadToast,
}: {
  storage: Pick<Storage, "setItem">;
  pageLoadId: string;
  reloadToast: ReloadToast;
}): void {
  const stash: ReloadToastStash = { pageLoadId, ...reloadToast };

  try {
    storage.setItem(RELOAD_TOAST_STORAGE_KEY, JSON.stringify(stash));
  } catch {
    // The write is saved; only the toast is lost.
  }
}

/**
 * Reads the stashed message once: it removes the key, so a later reload shows nothing.
 * The page that stashed it skips it: its RSC refresh can run the effect again before the reload.
 */
export function takeReloadToast({
  storage,
  pageLoadId,
}: {
  storage: Pick<Storage, "getItem" | "removeItem">;
  pageLoadId: string;
}): ReloadToast | null {
  try {
    const raw = storage.getItem(RELOAD_TOAST_STORAGE_KEY);

    if (raw === null) {
      return null;
    }

    const stash = parseReloadToastStash(raw);

    if (stash?.pageLoadId === pageLoadId) {
      return null;
    }

    storage.removeItem(RELOAD_TOAST_STORAGE_KEY);

    return stash ? { successMessage: stash.successMessage, cachePurge: stash.cachePurge } : null;
  } catch {
    return null;
  }
}

function parseReloadToastStash(raw: string): ReloadToastStash | null {
  try {
    const value: unknown = JSON.parse(raw);

    if (
      typeof value === "object" &&
      value !== null &&
      "pageLoadId" in value &&
      "successMessage" in value &&
      typeof value.pageLoadId === "string" &&
      typeof value.successMessage === "string"
    ) {
      return {
        pageLoadId: value.pageLoadId,
        successMessage: value.successMessage,
        cachePurge: "cachePurge" in value ? parseCachePurge(value.cachePurge) : undefined,
      };
    }
  } catch {
    // A malformed value counts as no stash.
  }

  return null;
}

// A stash from another build can hold any shape, so an unknown outcome shows no warning.
function parseCachePurge(value: unknown): CmsCachePurgeOutcome | undefined {
  if (
    typeof value === "object" &&
    value !== null &&
    "zone" in value &&
    "workersCache" in value &&
    isCmsPurgeStatus(value.zone) &&
    isCmsPurgeStatus(value.workersCache)
  ) {
    return { zone: value.zone, workersCache: value.workersCache };
  }

  return undefined;
}

function isCmsPurgeStatus(value: unknown): value is CmsPurgeStatus {
  return Object.values<unknown>(CMS_PURGE_STATUS).includes(value);
}

const CMS_PURGE_WARNING = {
  ZONE_FAILED: "zone_failed",
  WORKERS_CACHE_FAILED: "workers_cache_failed",
  ZONE_UNCONFIGURED: "zone_unconfigured",
} as const;

const CMS_PURGE_WARNING_COPY: Record<CmsPurgeWarning, { title: string; description: string }> = {
  // Only a configured zone can fail, so the stored copies carry the zone-purged TTL.
  [CMS_PURGE_WARNING.ZONE_FAILED]: {
    title: "The Cloudflare zone purge failed",
    description:
      "The change is saved. Other data centers can show the old page for up to " +
      `${EDGE_HTML_CACHE_ZONE_PURGED_TTL_MINUTES} minutes. To clear them now, run Purge Edge HTML ` +
      "Cache in Admin > System.",
  },
  [CMS_PURGE_WARNING.WORKERS_CACHE_FAILED]: {
    title: "The Workers Caching purge failed",
    description:
      "The change is saved. Edge copies of the Markdown pages, the sitemap, and the other machine " +
      "responses can stay until they expire. To clear them now, run Purge Workers CDN Cache in " +
      "Admin > System.",
  },
  [CMS_PURGE_WARNING.ZONE_UNCONFIGURED]: {
    title: ZONE_PURGE_MISSING_TITLE,
    description:
      `Other data centers can show old pages for up to ${EDGE_HTML_CACHE_TTL_MINUTES} minutes. ` +
      "See Admin > System.",
  },
};

type CmsPurgeWarning = typeof CMS_PURGE_WARNING[keyof typeof CMS_PURGE_WARNING];

interface ReloadToast {
  successMessage: string;
  cachePurge?: CmsCachePurgeOutcome;
}

interface ReloadToastStash extends ReloadToast {
  pageLoadId: string;
}

interface CmsWriteResult {
  cachePurge?: CmsCachePurgeOutcome;
}
