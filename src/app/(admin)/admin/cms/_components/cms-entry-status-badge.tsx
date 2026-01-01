import { Badge } from "@/components/ui/badge";
import { getStatusBadgeVariant, getStatusConfig } from "@/lib/cms/cms-entry-status-config";

interface CmsEntryStatusBadgeProps {
  status: string;
}

export function CmsEntryStatusBadge({ status }: CmsEntryStatusBadgeProps) {
  const statusConfig = getStatusConfig(status);
  
  return (
    <Badge variant={getStatusBadgeVariant(status)}>
      <div className="flex items-center gap-2">
        {statusConfig && <div className={`h-2 w-2 rounded-full ${statusConfig.color}`} />}
        <span>{statusConfig?.label || status}</span>
      </div>
    </Badge>
  );
}
