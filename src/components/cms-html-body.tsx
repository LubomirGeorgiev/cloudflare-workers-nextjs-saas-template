import "server-only";

import { cn } from "@/lib/utils";

import "@/components/tiptap-templates/simple/cms-content-styles.scss";

const CMS_CONTENT_ROOT_CLASS_NAME = "tiptap ProseMirror";

interface CmsHtmlBodyProps {
  html: string;
  className?: string;
}

export function CmsHtmlBody({ html, className }: CmsHtmlBodyProps) {
  // HTML comes from `renderCmsContentToHtml`, which escapes text and attributes.
  return (
    <div
      className={cn(CMS_CONTENT_ROOT_CLASS_NAME, className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
