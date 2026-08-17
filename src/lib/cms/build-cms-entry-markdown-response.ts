import "server-only";

import type { JSONContent } from "@tiptap/core";

import type { GetCmsCollectionResult } from "@/lib/cms/entry";
import { renderContentToMarkdown } from "@/lib/cms/render-content-to-markdown";
import { markdownDownloadDisposition } from "@/lib/markdown-pages/download-filename";
import { buildMarkdownDocument, singleLine } from "@/lib/markdown-pages/markdown-document";
import { rewriteContentPageLinks } from "@/lib/markdown-pages/rewrite-links";

/** An open fence remembers its character and length, because only a longer-or-equal run closes it. */
interface OpenFence {
  char: string;
  length: number;
}

// CommonMark: 3+ backticks or tildes, indented at most 3 spaces. Group 2 is the info string
// on an opening fence, and must be blank on a closing one.
const FENCE_LINE_PATTERN = /^ {0,3}((?:`{3,})|(?:~{3,}))(.*)$/;
const LEVEL_ONE_HEADING_PATTERN = /^#\s+/;
const SHIFTABLE_HEADING_PATTERN = /^(#{1,5})(\s+)/;

function stripRepeatedTitle({ markdown, title }: { markdown: string; title: string }): string {
  const lines = markdown.trim().split("\n");
  const firstHeading = lines[0]?.match(/^#\s+(.+)$/);

  if (firstHeading && singleLine(firstHeading[1]!) === singleLine(title)) {
    lines.shift();
  }

  return lines.join("\n").trim();
}

function nextFenceState({ line, openFence }: {
  line: string;
  openFence: OpenFence | null;
}): OpenFence | null {
  const match = FENCE_LINE_PATTERN.exec(line);

  if (!match) {
    return openFence;
  }

  const run = match[1]!;

  if (!openFence) {
    return { char: run[0]!, length: run.length };
  }

  const closes = run[0] === openFence.char
    && run.length >= openFence.length
    && match[2]!.trim() === "";

  return closes ? null : openFence;
}

function normalizeBodyHeadingLevels(markdown: string): string {
  const lines = markdown.split("\n");
  let openFence: OpenFence | null = null;
  let hasLevelOneHeading = false;

  for (const line of lines) {
    const wasInFence = openFence !== null;
    openFence = nextFenceState({ line, openFence });

    if (!wasInFence && !openFence && LEVEL_ONE_HEADING_PATTERN.test(line)) {
      hasLevelOneHeading = true;
    }
  }

  if (!hasLevelOneHeading) {
    return markdown;
  }

  openFence = null;
  return lines.map((line) => {
    const wasInFence = openFence !== null;
    openFence = nextFenceState({ line, openFence });

    if (wasInFence || openFence) {
      return line;
    }

    return line.replace(SHIFTABLE_HEADING_PATTERN, "#$1$2");
  }).join("\n");
}

function authorName(entry: GetCmsCollectionResult): string | null {
  if (!entry.createdByUser) {
    return null;
  }

  const fullName = [entry.createdByUser.firstName, entry.createdByUser.lastName]
    .filter(Boolean)
    .join(" ");

  return fullName || entry.createdByUser.email || null;
}

function isoDate(value: Date | null | undefined): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString().slice(0, 10)
    : null;
}

export function buildCmsEntryMarkdown({
  entry,
  sourceUrl,
}: {
  entry: GetCmsCollectionResult;
  sourceUrl: string;
}): string {
  const title = singleLine(entry.title);
  const author = authorName(entry);
  const published = isoDate(entry.publishedAt ?? entry.createdAt);
  const updated = isoDate(entry.updatedAt);
  const tags = entry.tags?.map(({ tag }) => singleLine(tag.name)).filter(Boolean) ?? [];
  const content = normalizeBodyHeadingLevels(
    stripRepeatedTitle({
      markdown: renderContentToMarkdown(rewriteContentPageLinks({
        content: entry.content as JSONContent,
        sourceUrl,
      })),
      title,
    }),
  );

  return buildMarkdownDocument({
    body: content,
    description: entry.seoDescription,
    metadataLines: [
      ...(author ? [`Author: ${author}`] : []),
      ...(published ? [`Published: ${published}`] : []),
      ...(updated ? [`Updated: ${updated}`] : []),
      ...(tags.length > 0 ? [`Tags: ${tags.join(", ")}`] : []),
    ],
    sourceUrl,
    title,
  });
}

// fallow-ignore-next-line unused-export -- CMS extensions can reuse the response helper.
export function buildCmsEntryMarkdownResponse({
  entry,
  sourceUrl,
}: {
  entry: GetCmsCollectionResult;
  sourceUrl: string;
}): Response {
  const markdown = buildCmsEntryMarkdown({ entry, sourceUrl });

  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": markdownDownloadDisposition({
        subject: `${entry.collection}/${entry.slug}`,
      }),
    },
  });
}
