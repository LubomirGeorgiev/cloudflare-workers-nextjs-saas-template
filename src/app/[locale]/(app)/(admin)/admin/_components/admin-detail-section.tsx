import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface AdminDetailSectionProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Rendered in place of the table when there is nothing to list. */
  emptyMessage: string;
  isEmpty: boolean;
  children: ReactNode;
}

// The card chrome every admin detail page repeats around a table — the user page's credential
// sections and the team page's members, invitations, and keys. Only the heading and the table
// itself differ, so only those are props.
export function AdminDetailSection({
  icon: Icon,
  title,
  description,
  emptyMessage,
  isEmpty,
  children,
}: AdminDetailSectionProps) {
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

/** One card per section, so the fallback matches the shape that replaces it. */
export function AdminDetailSectionsSkeleton() {
  return (
    <div className="grid gap-6">
      {[0, 1, 2].map((index) => (
        <Card key={index}>
          <CardContent className="space-y-3 py-6">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-full max-w-xl" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
