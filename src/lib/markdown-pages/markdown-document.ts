/**
 * The one frame every Markdown surface writes: the title heading, an optional description, the
 * `Source:` line, optional metadata lines, then the body. Both producers call this, so the scraped
 * page and the CMS entry cannot drift apart.
 */
interface BuildMarkdownDocumentParams {
  /** Already rendered Markdown. An empty body drops the blank line and the body block with it. */
  body: string;
  /** Omitted from the frame when it is missing or collapses to nothing. */
  description?: string | null;
  /** Extra lines written directly under `Source:`, in the order the caller gives them. */
  metadataLines?: readonly string[];
  sourceUrl: string;
  title: string;
}

/** Collapses every whitespace run to one space, so a frame line can never break across lines. */
export function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function buildMarkdownDocument({
  body,
  description,
  metadataLines = [],
  sourceUrl,
  title,
}: BuildMarkdownDocumentParams): string {
  const summary = description ? singleLine(description) : "";
  const lines = [
    `# ${singleLine(title)}`,
    ...(summary ? ["", summary] : []),
    "",
    `Source: ${sourceUrl}`,
    ...metadataLines,
  ];

  if (body) {
    lines.push("", body);
  }

  return `${lines.join("\n")}\n`;
}
