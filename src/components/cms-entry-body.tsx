"use client";

import { useRef } from "react";
import type { JSONContent } from "@tiptap/core";

import { CmsContentRenderer } from "@/components/cms-content-renderer";
import type { TableOfContentsItem } from "@/lib/cms/table-of-contents-tree";

interface CmsEntryBodyProps {
  content: JSONContent;
  className?: string;
  tableOfContents?: TableOfContentsItem[];
}

export function CmsEntryBody({
  content,
  className,
  tableOfContents,
}: CmsEntryBodyProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef}>
      <CmsContentRenderer
        content={content}
        className={className}
        onRendered={() => {
          if (!tableOfContents || tableOfContents.length === 0) {
            return;
          }

          const headings = containerRef.current?.querySelectorAll(
            "h1, h2, h3, h4, h5, h6"
          );

          headings?.forEach((heading, index) => {
            const item = tableOfContents[index];
            if (!item) {
              return;
            }

            heading.id = item.id;
            heading.classList.add("scroll-mt-24");
          });
        }}
      />
    </div>
  );
}
