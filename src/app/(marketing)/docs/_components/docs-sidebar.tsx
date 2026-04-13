"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { FileText, FolderTree } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CmsNavigationTreeNode } from "@/lib/cms/cms-navigation-repository";
import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation";

interface DocsSidebarProps {
  nodes: CmsNavigationTreeNode[];
  className?: string;
  onNavigate?: () => void;
}

function DocsSidebarNode({
  node,
  pathname,
  onNavigate,
  depth = 0,
}: {
  node: CmsNavigationTreeNode;
  pathname: string;
  onNavigate?: () => void;
  depth?: number;
}) {
  const hasChildren = node.children.length > 0;

  return (
    <div>
      {node.resolvedPath ? (
        <Link
          href={node.resolvedPath as Route}
          data-active={pathname === node.resolvedPath}
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted/70",
            pathname === node.resolvedPath && "bg-accent font-medium text-accent-foreground"
          )}
          style={{ paddingLeft: `${depth * 14 + 12}px` }}
        >
          {node.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE ? (
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <FolderTree className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{node.title}</span>
        </Link>
      ) : (
        <div
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-foreground/80"
          style={{ paddingLeft: `${depth * 14 + 12}px` }}
        >
          <FolderTree className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{node.title}</span>
        </div>
      )}

      {hasChildren ? (
        <div className="space-y-2">
          {node.children.map((child) => (
            <DocsSidebarNode
              key={child.id}
              depth={depth + 1}
              node={child}
              onNavigate={onNavigate}
              pathname={pathname}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DocsSidebar({ nodes, className, onNavigate }: DocsSidebarProps) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const activeItem = navRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    activeItem?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <nav ref={navRef} className={cn("space-y-3 px-3", className)} aria-label="Docs navigation">
      {nodes.map((node) => (
        <DocsSidebarNode
          key={node.id}
          node={node}
          onNavigate={onNavigate}
          pathname={pathname}
        />
      ))}
    </nav>
  );
}
