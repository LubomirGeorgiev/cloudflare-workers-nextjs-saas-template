import "server-only";

import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import type { RootContent } from "hast";
import { highlightCode } from "@/lib/highlight-code";

// Lowlight's editor plugin creates decorations. Static output needs those tokens as nodes.
export const StaticCodeBlock = CodeBlockLowlight.extend({
  renderHTML(props) {
    const spec = this.parent!(props);
    const tokens = highlightCode({ code: props.node.textContent, language: props.node.attrs.language });
    return replaceContentHole({ spec, content: tokens.map(highlightDomSpec) });
  },
});

function highlightDomSpec(node: RootContent): DOMOutputSpec | string {
  if (node.type === "text") {
    return node.value;
  }
  if (node.type === "element") {
    return [node.tagName, { class: Array.isArray(node.properties.className) ? node.properties.className.join(" ") : node.properties.className }, ...node.children.map(highlightDomSpec)];
  }
  return "";
}

// Preserve the extension's tags and attributes, and replace only its content slot.
// Asserting the shape makes a TipTap change fail loudly instead of emitting empty code blocks.
function replaceContentHole({ spec, content }: { spec: DOMOutputSpec; content: (DOMOutputSpec | string)[] }): DOMOutputSpec {
  const preParts: unknown[] = Array.isArray(spec) ? spec : [];
  const [preTag, preAttrs, codeSpec] = preParts;
  const codeParts: unknown[] = Array.isArray(codeSpec) ? codeSpec : [];
  const [codeTag, codeAttrs, hole] = codeParts;

  if (preTag !== "pre" || codeTag !== "code" || hole !== 0) {
    throw new Error(
      `Unexpected CodeBlockLowlight renderHTML output; expected ["pre", attrs, ["code", attrs, 0]], got ${JSON.stringify(spec)}`,
    );
  }

  return [preTag, preAttrs, [codeTag, codeAttrs, ...content]] as DOMOutputSpec;
}
