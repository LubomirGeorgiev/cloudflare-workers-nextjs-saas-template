"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  type TableOfContentsNode,
  flattenTableOfContentsIds,
} from "@/lib/cms/table-of-contents-tree";
import { cn } from "@/lib/utils";

/** Aligns with `scroll-mt-24` on article headings (6rem). */
const VIEWPORT_TOP_OFFSET_PX = 96;

function computeActiveSectionId(orderedIds: string[]): string | null {
  if (orderedIds.length === 0) {
    return null;
  }

  let active: string | null = null;
  for (const id of orderedIds) {
    const el = document.getElementById(id);
    if (!el) {
      continue;
    }

    const { top } = el.getBoundingClientRect();
    if (top <= VIEWPORT_TOP_OFFSET_PX) {
      active = id;
    }
  }

  return active ?? orderedIds[0] ?? null;
}

function TableOfContentsBranch({
  nodes,
  activeId,
  depth,
}: {
  nodes: TableOfContentsNode[];
  activeId: string | null;
  depth: number;
}) {
  return (
    <ul
      className={cn(
        "space-y-1",
        depth > 0 && "mt-1 pl-3"
      )}
    >
      {nodes.map((node) => (
        <li key={node.id}>
          <a
            href={`#${node.id}`}
            className={cn(
              "block py-1 pl-3 text-sm transition-colors",
              activeId === node.id
                ? "font-bold text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {node.text}
          </a>
          {node.children.length > 0 ? (
            <TableOfContentsBranch
              nodes={node.children}
              activeId={activeId}
              depth={depth + 1}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

interface ContentTableOfContentsNavProps {
  nodes: TableOfContentsNode[];
}

export function ContentTableOfContentsNav({
  nodes,
}: ContentTableOfContentsNavProps) {
  const orderedIds = useMemo(() => flattenTableOfContentsIds(nodes), [nodes]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const updateActive = useCallback(() => {
    setActiveId(computeActiveSectionId(orderedIds));
  }, [orderedIds]);

  useEffect(() => {
    updateActive();
    const t0 = window.setTimeout(updateActive, 0);
    const t1 = window.setTimeout(updateActive, 200);

    let raf: number | null = null;
    const scheduleUpdate = () => {
      if (raf != null) {
        return;
      }

      raf = requestAnimationFrame(() => {
        raf = null;
        updateActive();
      });
    };

    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate, { passive: true });
    window.addEventListener("hashchange", updateActive);

    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("hashchange", updateActive);
      if (raf != null) {
        cancelAnimationFrame(raf);
      }
    };
  }, [updateActive]);

  return (
    <nav className="mt-4" aria-label="On this page">
      <TableOfContentsBranch nodes={nodes} activeId={activeId} depth={0} />
    </nav>
  );
}
