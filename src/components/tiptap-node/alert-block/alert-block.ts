import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIconNode } from "@lucide/icons";
import { buildLucideIconNode } from "@lucide/icons/build";
import { mergeAttributes } from "@tiptap/core";
import type { DOMOutputSpec } from "@tiptap/pm/model";

import { cn } from "@/lib/utils";
import { normalizeAlertBlockAttrs } from "./alert-block-types";
import { alertDescriptionClassName, alertTitleClassName, alertVariants } from "@/components/ui/alert";

const ALERT_ICONS = {
  default: Info,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  destructive: CircleAlert,
};

interface AlertBlockDomSpecParams {
  attrs: Record<string, unknown>;
  HTMLAttributes?: Record<string, unknown>;
  titleAttributes?: Record<string, unknown>;
  bodyAttributes?: Record<string, unknown>;
  /** Keep the empty title and body slots so the node view can edit them. */
  editable: boolean;
  /** Consumer of the spec: React needs camel-cased SVG props, the DOM does not. */
  target: "html" | "react";
}

export function alertBlockDomSpec({
  attrs,
  HTMLAttributes = {},
  titleAttributes = {},
  bodyAttributes = {},
  editable,
  target,
}: AlertBlockDomSpecParams): DOMOutputSpec {
  const { title, body, variant } = normalizeAlertBlockAttrs(attrs);
  const icon = buildLucideIconNode(ALERT_ICONS[variant], {
    className: "size-4",
    attributes: { "aria-hidden": "true" },
  });
  const children: DOMOutputSpec[] = [lucideDomSpec({ icon, target })];
  if (title || editable) {
    children.push([
      "h5",
      mergeAttributes({ class: alertTitleClassName, "data-alert-title": "" }, titleAttributes),
      title,
    ]);
  }
  if (body || editable) {
    children.push([
      "div",
      mergeAttributes({
        class: `${alertDescriptionClassName} whitespace-pre-wrap`,
        "data-alert-body": "",
      }, bodyAttributes),
      body,
    ]);
  }
  return ["div", {
    ...HTMLAttributes,
    "data-type": "alert-block",
    "data-variant": variant,
    role: "alert",
    class: cn(alertVariants({ variant }), "not-prose my-6", HTMLAttributes.class as string | undefined),
  }, ...children];
}

// React accepts `data-*` and `aria-*` as written, but wants every other SVG
// property in camel case; the DOM keeps the original hyphenated names.
const REACT_VERBATIM_ATTR_PREFIXES = ["data-", "aria-"];

function toReactAttrName(name: string): string {
  if (REACT_VERBATIM_ATTR_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return name;
  }
  return name.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function lucideDomSpec({ icon: [tag, attributes, children], target }: {
  icon: LucideIconNode;
  target: "html" | "react";
}): DOMOutputSpec {
  const { key: __key, xmlns, ...attrs } = attributes;
  const svgAttrs = target === "react"
    ? Object.fromEntries(Object.entries(attrs).map(([name, value]) => [toReactAttrName(name), value]))
    : attrs;
  return [
    xmlns ? `${xmlns} ${tag}` : tag,
    svgAttrs,
    ...(children?.map((child) => lucideDomSpec({ icon: child, target })) ?? []),
  ];
}
