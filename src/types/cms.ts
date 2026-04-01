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
