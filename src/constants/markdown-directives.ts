/**
 * The one channel a page uses to steer its `.md` copy, read by `src/lib/markdown-pages/convert-html.ts`.
 * An accessibility attribute never decides what the Markdown holds, so a decorative element that
 * must also stay out of the Markdown carries `aria-hidden` and a directive, each saying one thing.
 */

/** The attribute a page writes. The converter reads hast's camelCased `dataMarkdown` instead. */
export const MARKDOWN_DIRECTIVE_ATTRIBUTE = "data-markdown";

export const MARKDOWN_DIRECTIVES = {
  /** Drop the element and everything inside it. */
  skip: "skip",
  /** Keep the content of an element the converter drops by default, such as a button. */
  unwrap: "unwrap",
} as const;
