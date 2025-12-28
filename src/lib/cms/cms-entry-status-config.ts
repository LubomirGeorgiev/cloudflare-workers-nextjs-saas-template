import { CMS_ENTRY_STATUS } from "@/app/enums";

export interface CmsEntryStatusConfig {
  value: string;
  label: string;
  color: string;
  badgeVariant: "default" | "secondary" | "outline" | "destructive";
}

export const CMS_ENTRY_STATUS_CONFIG: CmsEntryStatusConfig[] = [
  {
    value: CMS_ENTRY_STATUS.DRAFT,
    label: "Draft",
    color: "bg-gray-500",
    badgeVariant: "secondary",
  },
  {
    value: CMS_ENTRY_STATUS.PUBLISHED,
    label: "Published",
    color: "bg-green-500",
    badgeVariant: "default",
  },
  {
    value: CMS_ENTRY_STATUS.ARCHIVED,
    label: "Archived",
    color: "bg-orange-500",
    badgeVariant: "outline",
  },
] as const;

/**
 * Get the status configuration by value
 */
export function getStatusConfig(status: string): CmsEntryStatusConfig | undefined {
  return CMS_ENTRY_STATUS_CONFIG.find((config) => config.value === status);
}

/**
 * Get the badge variant for a status
 */
export function getStatusBadgeVariant(
  status: string
): "default" | "secondary" | "outline" | "destructive" {
  return getStatusConfig(status)?.badgeVariant ?? "secondary";
}
