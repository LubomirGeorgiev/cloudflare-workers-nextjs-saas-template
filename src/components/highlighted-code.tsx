"use client";

import type { ReactNode } from "react";

import type { RootContent } from "hast";
import { highlightCode } from "@/lib/highlight-code";
import { cn } from "@/lib/utils";

import "@/components/tiptap-templates/simple/code-highlighting.scss";

// The token colors come from the shared hljs theme; `hljs-code` is the selector that carries them
// outside the editor. Anything unregistered or unparseable falls back to plain text.

function astToReact(nodes: RootContent[], key = 0): ReactNode[] {
  return nodes.map((node, index) => {
    const nodeKey = `${key}-${index}`;

    if (node.type === "text") {
      return node.value ?? "";
    }

    if (node.type === "element") {
      const className = Array.isArray(node.properties?.className)
        ? node.properties.className.join(" ")
        : undefined;

      const children = node.children ? astToReact(node.children, index) : null;

      if (className) {
        return (
          <span key={nodeKey} className={className}>
            {children}
          </span>
        );
      }

      return children;
    }

    return null;
  });
}

export function HighlightedCode({
  code,
  language,
  className,
}: {
  code: string;
  language?: string;
  className?: string;
}) {
  return (
    <code className={cn("hljs-code", language && `language-${language}`, className)}>
      {astToReact(highlightCode({ code, language }))}
    </code>
  );
}
