"use client";

import type { ReactNode } from "react";

import { sharedLowlight } from "@/lib/lowlight";
import { cn } from "@/lib/utils";

import "@/components/tiptap-templates/simple/code-highlighting.scss";

// The token colors come from the shared hljs theme; `hljs-code` is the selector that carries them
// outside the editor. Anything unregistered or unparseable falls back to plain text.

/** Lowlight returns hast nodes; this is the subset needed for React conversion. */
interface LowlightASTNode {
  type: "text" | "element";
  value?: string;
  properties?: {
    className?: string[];
  };
  children?: LowlightASTNode[];
}

function astToReact(nodes: LowlightASTNode[], key = 0): ReactNode[] {
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

function highlightCode({
  code,
  language,
}: {
  code: string;
  language?: string;
}): ReactNode {
  if (!language || !sharedLowlight.registered(language)) {
    return code;
  }

  try {
    const result = sharedLowlight.highlight(language, code);

    return astToReact(result.children as LowlightASTNode[]);
  } catch {
    return code;
  }
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
      {highlightCode({ code, language })}
    </code>
  );
}
