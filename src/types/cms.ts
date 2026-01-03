import { CMS_ENTRY_STATUS } from "@/app/enums";

// Type for CMS entry status
export type CmsEntryStatus = typeof CMS_ENTRY_STATUS[keyof typeof CMS_ENTRY_STATUS];

// Tuple of all CMS entry status values for use in schemas
export const cmsEntryStatusTuple = Object.values(CMS_ENTRY_STATUS) as [CmsEntryStatus, ...CmsEntryStatus[]];
