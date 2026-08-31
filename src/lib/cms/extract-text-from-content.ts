import "server-only";

import type { JSONContent } from "@tiptap/core";

import { CMS_SEO_DESCRIPTION_MAX_LENGTH } from "@/constants";
import { ALERT_BLOCK_NODE_NAME } from "@/constants/cms-content-nodes";

function extractNodeText(node: JSONContent | undefined): string {
  if (!node) {
    return "";
  }

  if (typeof node.text === "string") {
    return node.text;
  }

  if (node.type === "image") {
    return typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
  }

  if (node.type === ALERT_BLOCK_NODE_NAME) {
    return [node.attrs?.title, node.attrs?.body]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" ");
  }

  return (node.content ?? []).map((child) => extractNodeText(child)).join(" ");
}

export function extractTextFromContent(content: JSONContent): string {
  if (!content) {
    return "";
  }

  try {
    return extractNodeText(content).replace(/\s+/g, " ").trim();
  } catch (error) {
    console.error("Error extracting text from content:", error);
    return "";
  }
}

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
