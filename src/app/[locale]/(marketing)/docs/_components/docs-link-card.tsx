import type { ReactNode } from "react";
import type { Route } from "next";

import { CmsNavigationNodeIcon } from "@/components/cms-navigation-node-icon";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { CmsIconBody, CmsNavigationNodeType } from "@/types/cms-navigation";

interface DocsLinkCardProps {
  href: Route;
  title: string;
  /** Icon of the navigation node this card points at, drawn by the shared icon ladder. */
  iconBody: CmsIconBody | null;
  nodeType: CmsNavigationNodeType;
  iconColor: string | null;
  description?: string | null;
  /** Small uppercase kicker above the title; the prev/next pair names the direction with it. */
  label?: string;
  /** Line under the description; the section index marks a group node with it. */
  footnote?: string;
  className?: string;
  /** Extra classes on the icon/text row, so a caller can mirror it towards the trailing edge. */
  rowClassName?: string;
}

// One card for every docs link surface: the section index tiles and the prev/next pair. Both must
// look the same, so the classes live here and not in the page.
export function DocsLinkCard({
  href,
  title,
  iconBody,
  nodeType,
  iconColor,
  description,
  label,
  footnote,
  className,
  rowClassName,
}: DocsLinkCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group rounded-2xl border border-border/70 bg-card/60 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:bg-muted/40 hover:shadow-sm",
        className
      )}
    >
      <div className={cn("flex items-start gap-4", rowClassName)}>
        <CmsNavigationNodeIcon
          iconBody={iconBody}
          nodeType={nodeType}
          iconColor={iconColor}
          className="mt-1 h-5 w-5 shrink-0"
        />
        <div className="min-w-0">
          {label ? (
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
          ) : null}
          <p
            className={cn(
              "font-medium transition-colors group-hover:text-foreground",
              label && "mt-2"
            )}
          >
            {title}
          </p>
          {description ? (
            <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{description}</p>
          ) : null}
          {footnote ? <p className="mt-2 text-sm text-muted-foreground">{footnote}</p> : null}
        </div>
      </div>
    </Link>
  );
}

// The column count follows the card count: a lone card fills the row instead of leaving half the
// grid empty, and three or more spread over a third column once there is room for one. The caller
// passes `count`: it knows the list length, while `Children.count` sees one node for a fragment.
export function DocsLinkCardGrid({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-4",
        count > 1 && "sm:grid-cols-2",
        count > 2 && "xl:grid-cols-3"
      )}
    >
      {children}
    </div>
  );
}
