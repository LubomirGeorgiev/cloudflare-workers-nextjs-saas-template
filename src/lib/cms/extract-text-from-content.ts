import "server-only";

import type { JSONContent } from "@tiptap/core";
import { renderToMarkdown } from "@tiptap/static-renderer/pm/markdown";
import { getTiptapBaseExtensions } from "@/lib/tiptap-base-extensions";
import { CMS_SEO_DESCRIPTION_MAX_LENGTH } from "@/constants";

/**
 * Extract plain text from TipTap JSON content using official markdown renderer
 * Used for generating meta descriptions and other text-only contexts
 */
export function extractTextFromContent(content: JSONContent): string {
  if (!content) return "";

  try {
    // Use TipTap's official markdown renderer with our base extensions
    const markdown = renderToMarkdown({
      extensions: getTiptapBaseExtensions(),
      content,
    });

    // Strip markdown formatting to get plain text
    // Remove markdown syntax like **bold**, *italic*, [links](url), etc.
    return markdown
      .replace(/[*_~`#]/g, "") // Remove markdown formatting characters
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Convert links to just text
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "") // Remove images
      .replace(/\n+/g, " ") // Convert newlines to spaces
      .trim();
  } catch (error) {
    console.error("Error extracting text from content:", error);
    return "";
  }
}

/**
 * Extract plain text and truncate for meta descriptions
 */
export function generateMetaDescription(
  content: JSONContent,
  maxLength: number = CMS_SEO_DESCRIPTION_MAX_LENGTH
): string {
  const plainText = extractTextFromContent(content)
    .replace(/\s+/g, " ")
    .trim();

  if (plainText.length <= maxLength) {
    return plainText;
  }

  return plainText.substring(0, maxLength - 3) + "...";
}
