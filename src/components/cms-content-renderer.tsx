"use client";

import React, { useEffect, type ReactNode } from "react";
import Image from "next/image";
import { type JSONContent } from "@tiptap/core";
import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import { getTiptapBaseExtensions, sharedLowlight } from "@/lib/tiptap-base-extensions";
import { cn } from "@/lib/utils";
import { CMS_IMAGES_API_ROUTE } from "@/constants";

import "@/components/tiptap-templates/simple/cms-content-styles.scss"

/**
 * Minimal type for lowlight AST nodes based on what we actually use.
 * Lowlight returns hast (Hypertext Abstract Syntax Tree) nodes, but we only
 * need a subset of the properties for our React conversion.
 */
interface LowlightASTNode {
  type: "text" | "element";
  value?: string;
  properties?: {
    className?: string[];
  };
  children?: LowlightASTNode[];
}

/**
 * Converts lowlight's AST (hast) to React elements with syntax highlighting classes
 */
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

/**
 * Extracts text content from React children recursively
 */
function extractTextFromChildren(children: ReactNode): string {
  if (typeof children === "string") {
    return children;
  }

  if (Array.isArray(children)) {
    return children.map(extractTextFromChildren).join("");
  }

  if (children && typeof children === "object") {
    const child = children as { props?: { children?: ReactNode; node?: { textContent?: string } } };

    // Check if this is a text node from TipTap
    if (child.props?.node?.textContent) {
      return child.props.node.textContent;
    }

    if (child.props?.children) {
      return extractTextFromChildren(child.props.children);
    }
  }

  return "";
}

/**
 * Custom CodeBlock component for TipTap static renderer that applies syntax highlighting
 * Uses lowlight to add syntax highlighting classes to code content
 */
function CodeBlockRenderer({
  language: propLanguage,
  children,
  node,
  ...__rest
}: CodeBlockRendererProps) {

  // Extract language from node.attrs if available, fallback to prop
  const language = node?.attrs?.language || propLanguage;

  // Extract code from node.textContent or from children
  let code = node?.textContent || "";

  if (!code && children) {
    code = extractTextFromChildren(children);
  }

  // If no language is specified or highlighting fails, render as plain text
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
  } catch (error) {
    console.error(`Failed to highlight ${language} code:`, error);
    // Fallback to plain code if highlighting fails
    return (
      <pre>
        <code className={`language-${language}`}>{code}</code>
      </pre>
    );
  }
}

/**
 * React component for rendering images in static content
 * Used by the TipTap static renderer via nodeMapping
 */
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
        // Always use Next.js Image for CMS images for optimization
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
        // External images - use regular img tag
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

export const CMS_CONTENT_ROOT_CLASS_NAME = "tiptap ProseMirror";

/**
 * Renders TipTap JSON content as React components
 * Uses Next.js Image component for optimized image loading
 * and custom CodeBlock component for syntax highlighting
 */
export function CmsContentRenderer({ content, className, onRendered }: CmsContentRendererProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const extensions = getTiptapBaseExtensions();

  const reactElement = renderToReactElement({
    extensions,
    content,
    options: {
      nodeMapping: {
        // Map the 'image' node to our custom Next.js Image component
        image: ImageComponent,
        // Map the 'codeBlock' node to our custom syntax highlighting component
        codeBlock: CodeBlockRenderer,
      },
    },
  });

  useEffect(() => {
    // Call onRendered callback after component has mounted and rendered
    // Use requestAnimationFrame to ensure DOM is updated
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
