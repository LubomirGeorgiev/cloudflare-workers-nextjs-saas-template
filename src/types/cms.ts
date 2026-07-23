import { CMS_ENTRY_STATUS } from "@/app/enums";

// Type for CMS entry status
export type CmsEntryStatus = typeof CMS_ENTRY_STATUS[keyof typeof CMS_ENTRY_STATUS];

// Tuple of all CMS entry status values for use in schemas
export const cmsEntryStatusTuple = Object.values(CMS_ENTRY_STATUS) as [CmsEntryStatus, ...CmsEntryStatus[]];

export const CMS_STATUS_FILTER_ALL = "all" as const;

export type CmsStatusFilter = CmsEntryStatus | typeof CMS_STATUS_FILTER_ALL;

export const cmsStatusFilterTuple = [
  ...cmsEntryStatusTuple,
  CMS_STATUS_FILTER_ALL,
] as const satisfies readonly [CmsStatusFilter, ...CmsStatusFilter[]];

// The entry fields that get AI-translated and are therefore tracked for staleness:
// changing anything else (featured image, status, publish date) never marks a
// translation out of date. Order is the display order in the stale banner.
export const TRANSLATABLE_ENTRY_FIELDS = ["title", "seoDescription", "content"] as const;

export type TranslatableEntryField = (typeof TRANSLATABLE_ENTRY_FIELDS)[number];

// Snapshot of the canonical (default-locale) source entry's per-field content
// hashes, captured when a translation was created or last refreshed. Stored on the
// translation row so the editor can detect when the source has since drifted.
export type SourceContentHashes = Record<TranslatableEntryField, string>;

// `cms_entry.status` is a plain string column; guard raw DB values with this
// rather than casting, so an unexpected status is caught instead of trusted.
export function isCmsEntryStatus(value: string): value is CmsEntryStatus {
  return (cmsEntryStatusTuple as readonly string[]).includes(value);
}
