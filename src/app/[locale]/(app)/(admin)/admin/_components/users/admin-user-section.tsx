import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface AdminUserSectionProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Rendered in place of the table when there is nothing to list. */
  emptyMessage: string;
  isEmpty: boolean;
  children: ReactNode;
}

// The card chrome the three revocable-credential sections repeat around their tables; only the
// heading and the table itself differ, so only those are props.
export function AdminUserSection({
  icon: Icon,
  title,
  description,
  emptyMessage,
  isEmpty,
  children,
}: AdminUserSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {isEmpty ? <p className="text-sm text-muted-foreground">{emptyMessage}</p> : children}
      </CardContent>
    </Card>
  );
}
