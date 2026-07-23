"use client";

import React, { useEffect, type ReactNode } from "react";
import Image from "next/image";
import { type JSONContent } from "@tiptap/core";
import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import { getTiptapBaseExtensions, sharedLowlight } from "@/lib/tiptap-base-extensions";
import { cn } from "@/lib/utils";
import { CMS_IMAGES_API_ROUTE } from "@/constants";
import { AlertBlock } from "@/components/tiptap-node/alert-block/alert-block";
import {
  ALERT_BLOCK_NODE_NAME,
  type AlertBlockAttrs,
} from "@/components/tiptap-node/alert-block/alert-block-types";

import "@/components/tiptap-templates/simple/cms-content-styles.scss"

const CMS_CONTENT_ROOT_CLASS_NAME = "tiptap ProseMirror";

// Lowlight returns hast nodes; this is the subset needed for React conversion.
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

interface CodeBlockRendererProps {
  language?: string;
  children?: ReactNode;
  node?: {
    attrs?: {
      language?: string;
    };
    textContent?: string;
  };
  [key: string]: unknown;
}

function extractTextFromChildren(children: ReactNode): string {
  if (typeof children === "string") {
    return children;
  }

  if (Array.isArray(children)) {
    return children.map(extractTextFromChildren).join("");
  }

  if (children && typeof children === "object") {
    const child = children as { props?: { children?: ReactNode; node?: { textContent?: string } } };

    // TipTap text nodes carry textContent on props.node.
    if (child.props?.node?.textContent) {
      return child.props.node.textContent;
    }

    if (child.props?.children) {
      return extractTextFromChildren(child.props.children);
    }
  }

  return "";
}

function CodeBlockRenderer({
  language: propLanguage,
  children,
  node,
  ...__rest
}: CodeBlockRendererProps) {

  const language = node?.attrs?.language || propLanguage;

  let code = node?.textContent || "";

  if (!code && children) {
    code = extractTextFromChildren(children);
  }

  if (!language) {
    return (
      <pre>
        <code>{code}</code>
      </pre>
    );
  }

  try {
    const result = sharedLowlight.highlight(language, code);
    const highlightedContent = astToReact(result.children as LowlightASTNode[]);

    return (
      <pre>
        <code className={`language-${language}`}>{highlightedContent}</code>
      </pre>
    );
  } catch {
    return (
      <pre>
        <code className={`language-${language}`}>{code}</code>
      </pre>
    );
  }
}

function ImageComponent({
  node,
}: {
  node: {
    attrs: Record<string, unknown>;
  };
}) {
  const { src, alt, title, width, height } = node.attrs;
  const isCmsImage = (src as string)?.startsWith(CMS_IMAGES_API_ROUTE);

  return (
    <div className="my-6">
      {isCmsImage ? (
        <Image
          quality={80}
          src={src as string}
          alt={(alt as string) || ""}
          width={(width as number) || 0}
          height={(height as number) || 0}
          className="rounded-lg w-full h-auto"
          title={title as string}
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 80vw, 1200px"
          style={{ width: '100%', height: 'auto' }}
        />
      ) : (
        // oxlint-disable-next-line nextjs/no-img-element
        <img
          src={src as string}
          alt={(alt as string) || ""}
          title={title as string}
          className="rounded-lg max-w-full h-auto"
        />
      )}
    </div>
  );
}

interface CmsContentRendererProps {
  content: JSONContent;
  className?: string;
  onRendered?: () => void;
}

export function CmsContentRenderer({ content, className, onRendered }: CmsContentRendererProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const extensions = getTiptapBaseExtensions();

  const reactElement = renderToReactElement({
    extensions,
    content,
    options: {
      nodeMapping: {
        image: ImageComponent,
        codeBlock: CodeBlockRenderer,
        // Render custom CMS alert blocks with shared alert styles.
        [ALERT_BLOCK_NODE_NAME]: ({ node }: { node: { attrs?: Record<string, unknown> } }) => (
          <AlertBlock
            {...(node.attrs as AlertBlockAttrs | undefined)}
          />
        ),
      },
    },
  });

  useEffect(() => {
    // Wait one frame so consumers observe the rendered DOM.
    if (onRendered && containerRef.current) {
      requestAnimationFrame(() => {
        onRendered();
      });
    }
  }, [onRendered, content]);

  return (
    <div
      ref={containerRef}
      className={cn(CMS_CONTENT_ROOT_CLASS_NAME, className)}
    >
      {reactElement}
    </div>
  );
}
