import { mergeAttributes } from "@tiptap/core";
import { Image } from "@tiptap/extension-image";
import { CMS_IMAGES_API_ROUTE, IMAGE_OPTIMIZATION_PATH } from "@/constants";
import { CMS_IMAGE_FALLBACK_WIDTH, CMS_IMAGE_QUALITY, CMS_IMAGE_SIZES, IMAGE_DEVICE_SIZES } from "@/constants/images";

const CMS_IMAGE_WIDTHS = [...IMAGE_DEVICE_SIZES].sort((left, right) => left - right);

export const CmsImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        // HTML exports retain the original source for the editor and Markdown conversion.
        parseHTML: (element) => element.getAttribute("data-cms-src") ?? element.getAttribute("src"),
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
    const isCmsImage = src.startsWith(`${CMS_IMAGES_API_ROUTE}/`);
    const attrs = mergeAttributes(HTMLAttributes, {
      class: isCmsImage ? "rounded-lg w-full h-auto" : "rounded-lg max-w-full h-auto",
      width: positiveDimension(node.attrs.width),
      height: positiveDimension(node.attrs.height),
      ...(isCmsImage ? cmsImageAttrs(src) : {}),
    });
    return ["div", { class: "my-6" }, this.parent!({ node, HTMLAttributes: attrs })];
  },
});

function positiveDimension(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function optimizedImageUrl({ src, width }: { src: string; width: number }) {
  return `${IMAGE_OPTIMIZATION_PATH}?url=${encodeURIComponent(src)}&w=${width}&q=${CMS_IMAGE_QUALITY}`;
}

function cmsImageAttrs(src: string) {
  // Vinext exposes getImageProps as a client reference in RSC.
  // The optimizer uses these same widths.
  return {
    "data-cms-src": src,
    src: optimizedImageUrl({ src, width: CMS_IMAGE_FALLBACK_WIDTH }),
    srcset: CMS_IMAGE_WIDTHS.map((width) => `${optimizedImageUrl({ src, width })} ${width}w`).join(", "),
    sizes: CMS_IMAGE_SIZES,
    loading: "lazy",
    decoding: "async",
    style: "width:100%;height:auto",
  };
}
