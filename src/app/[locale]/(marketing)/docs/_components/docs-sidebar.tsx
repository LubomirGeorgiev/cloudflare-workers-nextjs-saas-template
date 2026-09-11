"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

import { CmsNavigationNodeIcon } from "@/components/cms-navigation-node-icon";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { CmsNavigationTreeNode } from "@/lib/cms/cms-navigation-repository";
import type { CmsIconBodyByKey } from "@/types/cms-navigation";
import { getNavigationNodeDisplayTitle } from "@/types/cms-navigation";

import { getDocsNavPaddingLeft } from "./docs-nav-indent";

interface DocsSidebarProps {
  nodes: CmsNavigationTreeNode[];
  /** Icon markup for the whole tree, held once per key rather than once per node. */
  iconBodyByKey: CmsIconBodyByKey;
  className?: string;
  onNavigate?: () => void;
}

function DocsSidebarNode({
  node,
  iconBodyByKey,
  pathname,
  onNavigate,
  depth = 0,
}: {
  node: CmsNavigationTreeNode;
  iconBodyByKey: CmsIconBodyByKey;
  pathname: string;
  onNavigate?: () => void;
  depth?: number;
}) {
  const hasChildren = node.children.length > 0;
  const title = getNavigationNodeDisplayTitle(node);
  const icon = (
    <CmsNavigationNodeIcon
      iconBody={(node.icon ? iconBodyByKey[node.icon] : null) ?? null}
      nodeType={node.nodeType}
      iconColor={node.iconColor}
      className="h-4 w-4 shrink-0"
    />
  );

  return (
    <div>
      {node.resolvedPath ? (
        <Link
          href={node.resolvedPath}
          data-active={pathname === node.resolvedPath}
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted/70",
            pathname === node.resolvedPath && "bg-accent font-medium text-accent-foreground"
          )}
          style={{ paddingLeft: getDocsNavPaddingLeft(depth) }}
        >
          {icon}
          <span className="truncate">{title}</span>
        </Link>
      ) : (
        <div
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-foreground/80"
          style={{ paddingLeft: getDocsNavPaddingLeft(depth) }}
        >
          {icon}
          <span className="truncate">{title}</span>
        </div>
      )}

      {hasChildren ? (
        <div className="space-y-2">
          {node.children.map((child) => (
            <DocsSidebarNode
              key={child.id}
              depth={depth + 1}
              node={child}
              iconBodyByKey={iconBodyByKey}
              onNavigate={onNavigate}
              pathname={pathname}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DocsSidebar({
  nodes,
  iconBodyByKey,
  className,
  onNavigate,
}: DocsSidebarProps) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement | null>(null);
  const t = useTranslations("Client.Docs.Navigation");

  useEffect(() => {
    const activeItem = navRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    activeItem?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <nav ref={navRef} className={cn("space-y-3 px-3", className)} aria-label={t("navAriaLabel")}>
      {nodes.map((node) => (
        <DocsSidebarNode
          key={node.id}
          node={node}
          iconBodyByKey={iconBodyByKey}
          onNavigate={onNavigate}
          pathname={pathname}
        />
      ))}
    </nav>
  );
}
