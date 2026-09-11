import { cn } from "@/lib/utils";
import type { CmsIconBody } from "@/types/cms-navigation";

/**
 * Whether `color` changes what this icon draws.
 *
 * A document only follows the CSS `color` property where it paints with `currentColor`; one that
 * names its own paint — most uploaded brand marks — ignores it. The colour control reads this to
 * decide whether it may offer a colour at all, so the offer can never outrun the renderer.
 */
export function iconFollowsCurrentColor(icon: CmsIconBody): boolean {
  return icon.markup.toLowerCase().includes("currentcolor");
}

/**
 * What an icon colour control may tell an admin, picked by the predicate above so the promise can
 * never outrun the renderer. Here rather than in the panel because the rule and the words for it
 * are one thing — `cms-icon.test.ts` pins the pair.
 */
export const ICON_COLOR_HELP = {
  recolorable:
    "Blank keeps the node type color, the same one the public navigation draws. A color here replaces it, in both themes.",
  selfPainted:
    "This icon paints its own colors, so a color here would change nothing. Pick an icon that follows the text color to recolor it.",
} as const;

/**
 * Renders a pinned icon by inlining its `<svg>` document verbatim.
 *
 * The document is inlined rather than rebuilt, so an uploaded file keeps its own root attributes —
 * `viewBox` origin, `preserveAspectRatio`, `overflow`, whatever its author wrote. That means the
 * element carries its own `width`/`height`, so the span sizes it from the outside: a CSS rule beats
 * a presentation attribute, and `size-full` on the child is what makes `className` work here.
 *
 * `markup` reaches `dangerouslySetInnerHTML` only because `sanitizeIconMarkup` accepted it on the
 * server, which is the one writer of the column this reads.
 *
 * `color` sets the CSS `color` property, which is what a `currentColor` inside the document
 * resolves against. A document that names its own paint ignores it, which is the point: an
 * uploaded brand mark keeps its colours. Pass nothing to keep inheriting.
 */
export function CmsIcon({
  icon,
  className,
  color,
}: {
  icon: CmsIconBody;
  className?: string;
  color?: string | null;
}) {
  return (
    <span
      className={cn("inline-flex shrink-0 [&>svg]:size-full", className)}
      style={color ? { color } : undefined}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: icon.markup }}
    />
  );
}
