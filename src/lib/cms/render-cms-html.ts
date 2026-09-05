import "server-only";

import { Extension, type JSONContent } from "@tiptap/core";
import { renderToHTMLString } from "@tiptap/static-renderer/pm/html-string";
import { StaticCodeBlock } from "@/components/tiptap-node/code-block-node/code-block-static-extension";
import { CmsImage } from "@/components/tiptap-node/image-node/image-node-extension";
import { getNodeText, nextHeadingId } from "@/lib/cms/extract-table-of-contents";
import { getTiptapBaseExtensions } from "@/lib/tiptap-base-extensions";

const HeadingAnchor = Extension.create({
  name: "cmsHeadingAnchor",
  addGlobalAttributes() {
    return [{
      types: ["heading"],
      attributes: {
        id: {
          default: null,
          renderHTML: (attrs) => attrs.id ? { id: attrs.id, class: "scroll-mt-24" } : {},
        },
      },
    }];
  },
});
let extensions: ReturnType<typeof getTiptapBaseExtensions> | undefined;

export function renderCmsContentToHtml({ content }: {
  content: JSONContent;
}): string {
  extensions ??= [
    ...getTiptapBaseExtensions({ codeBlockExtension: StaticCodeBlock, imageExtension: CmsImage }),
    HeadingAnchor,
  ];
  const usedIds = new Map<string, number>();
  function withHeadingIds(node: JSONContent): JSONContent {
    const headingText = node.type === "heading" ? getNodeText(node).trim() : "";
    const id = headingText ? nextHeadingId({ usedIds, text: headingText }) : undefined;
    return {
      ...node,
      ...(node.type === "heading" ? { attrs: { ...node.attrs, id: id ?? null } } : {}),
      ...(node.content ? { content: node.content.filter(hasPublicContent).map(withHeadingIds) } : {}),
    };
  }
  return renderToHTMLString({ content: withHeadingIds(content), extensions });
}

function hasPublicContent(node: JSONContent): boolean {
  // Failed or incomplete uploads can leave editor placeholders in saved content.
  if (node.type === "imageUpload") {
    return false;
  }
  if (node.type === "image") {
    return typeof node.attrs?.src === "string" && node.attrs.src.trim().length > 0;
  }
  return true;
}
