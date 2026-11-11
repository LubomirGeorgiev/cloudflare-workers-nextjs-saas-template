import { splitInlineCode } from "@/lib/api/reference-model";

/** Description text from the document, with its backtick spans as code. */
export function ApiProse({ text }: { text: string }) {
  return splitInlineCode(text).map((segment, index) =>
    segment.code ? (
      <code key={index} className="font-mono text-foreground">
        {segment.text}
      </code>
    ) : (
      segment.text
    ),
  );
}
