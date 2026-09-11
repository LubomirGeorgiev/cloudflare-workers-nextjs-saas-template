import { FileText, FolderTree } from "lucide-react";

import { CmsIcon } from "@/components/cms-icon";
import { cn } from "@/lib/utils";
import {
  CMS_NAVIGATION_NODE_TYPES,
  type CmsIconBody,
  type CmsNavigationNodeType,
} from "@/types/cms-navigation";

/**
 * Tint of the node-type fallback. The editor and the public navigation both read it from here, so
 * a preview can never colour a node differently from the site.
 */
export const CMS_NAVIGATION_TYPE_ICON_CLASS: Record<CmsNavigationNodeType, string> = {
  [CMS_NAVIGATION_NODE_TYPES.PAGE]: "text-blue-500",
  [CMS_NAVIGATION_NODE_TYPES.GROUP]: "text-amber-500",
};

interface CmsNavigationNodeIconProps {
  /** Markup of the admin-chosen icon; null or undefined falls back to the node-type icon. */
  iconBody: CmsIconBody | null | undefined;
  nodeType: CmsNavigationNodeType;
  /** Admin-chosen colour; null keeps the type tint. Applies to the fallback too. */
  iconColor: string | null | undefined;
  className?: string;
}

// The one ladder every navigation surface draws: the chosen icon wins, otherwise the node type
// speaks for itself. Callers pass sizing only — the colour rule lives here.
export function CmsNavigationNodeIcon({
  iconBody,
  nodeType,
  iconColor,
  className,
}: CmsNavigationNodeIconProps) {
  if (iconBody) {
    return <CmsIcon icon={iconBody} className={className} color={iconColor} />;
  }

  const Icon = nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE ? FileText : FolderTree;

  return (
    <Icon
      className={cn(CMS_NAVIGATION_TYPE_ICON_CLASS[nodeType], className)}
      style={iconColor ? { color: iconColor } : undefined}
    />
  );
}
