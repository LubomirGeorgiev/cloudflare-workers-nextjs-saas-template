import type { JSONContent } from "@tiptap/core";

import { buildMarkdownPagePath } from "./page-paths";
import { resolveMdRequestTarget } from "./resolve-target";

function markdownPathForPage(pathname: string): string | null {
  const candidate = buildMarkdownPagePath({ pathname });

  return resolveMdRequestTarget(candidate) ? candidate : null;
}

export function rewritePageLinkUrl({
  href,
  sourceUrl,
}: {
  href: unknown;
  sourceUrl: string;
}): string | undefined {
  if (typeof href !== "string") {
    return undefined;
  }

  if (href.startsWith("#")) {
    return href;
  }

  try {
    const source = new URL(sourceUrl);
    const target = new URL(href, source);

    if (target.origin !== source.origin) {
      return target.toString();
    }

    const markdownPath = target.pathname.toLowerCase().endsWith(".md")
      ? (resolveMdRequestTarget(target.pathname) ? target.pathname : null)
      : markdownPathForPage(target.pathname);

    if (markdownPath) {
      target.pathname = markdownPath;
    }

    return target.toString();
  } catch {
    return href;
  }
}

export function rewriteContentPageLinks({
  content,
  sourceUrl,
}: {
  content: JSONContent;
  sourceUrl: string;
}): JSONContent {
  return {
    ...content,
    ...(content.marks
      ? {
          marks: content.marks.map((mark) => {
            if (mark.type !== "link" || !mark.attrs) {
              return mark;
            }

            return {
              ...mark,
              attrs: {
                ...mark.attrs,
                href: rewritePageLinkUrl({ href: mark.attrs.href, sourceUrl }),
              },
            };
          }),
        }
      : {}),
    ...(content.content
      ? {
          content: content.content.map((child) => {
            return rewriteContentPageLinks({ content: child, sourceUrl });
          }),
        }
      : {}),
  };
}
