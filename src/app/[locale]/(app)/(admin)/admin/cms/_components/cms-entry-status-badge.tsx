import { Badge } from "@/components/ui/badge";
import { getStatusBadgeVariant, getStatusConfig } from "@/lib/cms/cms-entry-status-config";

interface CmsEntryStatusBadgeProps {
  status: string;
  className?: string;
  /** Native tooltip, for callers that need to spell out what the status means in their context. */
  title?: string;
}

export function CmsEntryStatusBadge({ status, className, title }: CmsEntryStatusBadgeProps) {
  const statusConfig = getStatusConfig(status);

  return (
    <Badge variant={getStatusBadgeVariant(status)} className={className} title={title}>
      <div className="flex items-center gap-2">
        {statusConfig && <div className={`h-2 w-2 rounded-full ${statusConfig.color}`} />}
        <span>{statusConfig?.label || status}</span>
      </div>
    </Badge>
  );
}
