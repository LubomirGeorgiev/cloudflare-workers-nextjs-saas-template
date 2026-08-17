import type { Element, ElementContent, Root, RootContent } from "hast";
import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

import { SITE_NAME } from "@/constants";
import { MARKDOWN_DIRECTIVES } from "@/constants/markdown-directives";

import { buildMarkdownDocument, singleLine } from "./markdown-document";
import { rewritePageLinkUrl } from "./rewrite-links";

const REMOVED_TAGS = new Set([
  "aside",
  "nav",
  "script",
  "style",
  "svg",
  "template",
]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const BLOCK_CONTENT_TAGS = new Set([
  "article",
  "aside",
  "blockquote",
  "div",
  "footer",
  "header",
  "main",
  "ol",
  "p",
  "section",
  "table",
  "ul",
  ...HEADING_TAGS,
]);

/** Appended to every page title by the root layout template in `src/utils/root-metadata.ts`. */
const TITLE_SITE_NAME_SUFFIX = ` - ${SITE_NAME}`;

interface MarkdownMetadata {
  description: string;
  title: string;
}

interface ConvertHtmlToMarkdownParams {
  html: string;
  sourceUrl: string;
}

function isElement(node: RootContent | ElementContent): node is Element {
  return node.type === "element";
}

function findFirstElement(root: Root | Element, tagName: string): Element | null {
  const pending: Array<RootContent | ElementContent> = [...root.children];

  while (pending.length > 0) {
    const node = pending.shift()!;
    if (!isElement(node)) {
      continue;
    }

    if (node.tagName === tagName) {
      return node;
    }

    pending.unshift(...node.children);
  }

  return null;
}

function absoluteResourceUrl(value: unknown, sourceUrl: string): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  if (value.startsWith("#")) {
    return value;
  }

  try {
    return new URL(value, sourceUrl).toString();
  } catch {
    return value;
  }
}

function makeResourceUrlsAbsolute({
  children,
  sourceUrl,
}: {
  children: ElementContent[];
  sourceUrl: string;
}): ElementContent[] {
  return children.map((child): ElementContent => {
    if (!isElement(child)) {
      return child;
    }

    const properties = { ...child.properties };
    if (child.tagName === "a") {
      properties.href = rewritePageLinkUrl({ href: properties.href, sourceUrl });
    } else if (child.tagName === "img") {
      properties.src = absoluteResourceUrl(properties.src, sourceUrl);
    }

    return {
      ...child,
      properties,
      children: makeResourceUrlsAbsolute({ children: child.children, sourceUrl }),
    };
  });
}

function hasBlockContent(children: ElementContent[]): boolean {
  return children.some((child) => {
    return isElement(child) &&
      (BLOCK_CONTENT_TAGS.has(child.tagName) || hasBlockContent(child.children));
  });
}

function linkFirstHeading({
  children,
  properties,
}: {
  children: ElementContent[];
  properties: Element["properties"];
}): { children: ElementContent[]; didLink: boolean } {
  let didLink = false;
  const linked = children.map((child): ElementContent => {
    if (didLink || !isElement(child)) {
      return child;
    }

    if (HEADING_TAGS.has(child.tagName)) {
      didLink = true;
      return findFirstElement(child, "a")
        ? child
        : {
            ...child,
            children: [
              {
                type: "element",
                tagName: "a",
                properties: { href: properties.href },
                children: child.children,
              },
            ],
          };
    }

    const nested = linkFirstHeading({ children: child.children, properties });
    if (nested.didLink) {
      didLink = true;
      return { ...child, children: nested.children };
    }

    return child;
  });

  return { children: linked, didLink };
}

function normalizeBlockLinks(children: ElementContent[]): ElementContent[] {
  return children.flatMap((child): ElementContent[] => {
    if (!isElement(child)) {
      return [child];
    }

    const normalized: Element = {
      ...child,
      children: normalizeBlockLinks(child.children),
    };

    if (normalized.tagName !== "a" || !hasBlockContent(normalized.children)) {
      return [normalized];
    }

    const linked = linkFirstHeading({
      children: normalized.children,
      properties: normalized.properties,
    });

    // Without a heading, keep the original link so the conversion does not drop its destination.
    return linked.didLink ? linked.children : [normalized];
  });
}

function textContent(node: Root | Element): string {
  const pending: Array<RootContent | ElementContent> = [...node.children];
  const text: string[] = [];

  while (pending.length > 0) {
    const child = pending.shift()!;
    if (child.type === "text") {
      text.push(child.value);
    } else if (isElement(child)) {
      if (child.tagName === "br") {
        text.push(" ");
      } else {
        pending.unshift(...child.children);
      }
    }
  }

  return text.join("").replace(/\s+/g, " ").trim();
}

/** hast camelCases data attributes, so `data-markdown` parses as this property. */
function markdownDirective(element: Element): string | null {
  const value = element.properties.dataMarkdown;
  return typeof value === "string" ? value : null;
}

function isHeadingChild(parentTagName?: string): boolean {
  return Boolean(parentTagName && HEADING_TAGS.has(parentTagName));
}

function filterElement({
  element,
  parentTagName,
}: {
  element: Element;
  parentTagName?: string;
}): ElementContent[] {
  const directive = markdownDirective(element);

  if (REMOVED_TAGS.has(element.tagName) || directive === MARKDOWN_DIRECTIVES.skip) {
    return [];
  }

  if (element.tagName === "br" && isHeadingChild(parentTagName)) {
    return [{ type: "text", value: " " }];
  }

  // The page declares which interactive elements hold document content, so no component shape is
  // encoded here.
  if (directive === MARKDOWN_DIRECTIVES.unwrap) {
    return filterContent(element.children, element.tagName);
  }

  // A button is a page action, not document content, unless the page unwraps it.
  if (element.tagName === "button") {
    return [];
  }

  return [
    {
      ...element,
      children: filterContent(element.children, element.tagName),
    },
  ];
}

function areAdjacentLinks(previous: ElementContent | undefined, next: ElementContent): boolean {
  return Boolean(
    previous &&
    isElement(previous) &&
    previous.tagName === "a" &&
    isElement(next) &&
    next.tagName === "a",
  );
}

function filterContent(children: ElementContent[], parentTagName?: string): ElementContent[] {
  const filtered: ElementContent[] = [];

  for (const child of children) {
    if (!isElement(child)) {
      if (child.type !== "comment") {
        filtered.push(child);
      }
      continue;
    }

    const nextChildren = filterElement({ element: child, parentTagName });

    // JSX often renders adjacent action links with no text node between them. Keep the links
    // separate so Markdown parsers do not read `)[` as one malformed inline sequence.
    if (nextChildren[0] && areAdjacentLinks(filtered.at(-1), nextChildren[0])) {
      filtered.push({ type: "text", value: " " });
    }

    filtered.push(...nextChildren);
  }

  return filtered;
}

function removeRepeatedTitleHeadings({
  children,
  title,
}: {
  children: ElementContent[];
  title: string;
}): ElementContent[] {
  return children.flatMap((child): ElementContent[] => {
    if (!isElement(child)) {
      return [child];
    }

    if (child.tagName === "h1" && singleLine(textContent(child)) === title) {
      return [];
    }

    return [
      {
        ...child,
        children: removeRepeatedTitleHeadings({ children: child.children, title }),
      },
    ];
  });
}

/**
 * Takes the page heading structurally, in document order, so the frame never repeats it as a body
 * heading. A string match against the document `<title>` cannot do this: the title carries the
 * site-name suffix and the `<h1>` does not.
 */
function takeFirstHeading(children: ElementContent[]): {
  children: ElementContent[];
  title: string | null;
} {
  const kept: ElementContent[] = [];
  let title: string | null = null;

  for (const child of children) {
    if (title !== null || !isElement(child)) {
      kept.push(child);
      continue;
    }

    if (child.tagName === "h1") {
      const heading = textContent(child);
      if (heading) {
        title = heading;
        continue;
      }
    }

    const nested = takeFirstHeading(child.children);
    title = nested.title;
    kept.push({ ...child, children: nested.children });
  }

  return { children: kept, title };
}

function extractMetadata(root: Root): MarkdownMetadata {
  const titleElement = findFirstElement(root, "title");
  const title = titleElement ? textContent(titleElement) : "";
  let description = "";
  const pending: Array<RootContent | ElementContent> = [...root.children];

  while (pending.length > 0 && !description) {
    const node = pending.shift()!;
    if (!isElement(node)) {
      continue;
    }

    if (
      node.tagName === "meta" &&
      node.properties.name === "description" &&
      typeof node.properties.content === "string"
    ) {
      description = node.properties.content.trim();
      break;
    }

    pending.unshift(...node.children);
  }

  return { title, description };
}

function stripSiteName(title: string): string {
  return title.endsWith(TITLE_SITE_NAME_SUFFIX)
    ? title.slice(0, -TITLE_SITE_NAME_SUFFIX.length).trim()
    : title;
}

/** Returns `null` when the page shape defeats the conversion, so the caller can answer 406. */
export async function convertHtmlToMarkdown({
  html,
  sourceUrl,
}: ConvertHtmlToMarkdownParams): Promise<string | null> {
  const processor = unified()
    .use(rehypeParse)
    .use(rehypeRemark)
    .use(remarkGfm)
    .use(remarkStringify, {
      bullet: "-",
      fences: true,
      setext: false,
    });
  const document = processor.parse(html) as Root;
  const main = findFirstElement(document, "main");

  if (!main) {
    return null;
  }

  const metadata = extractMetadata(document);
  const filtered = filterContent(main.children);
  const normalized = normalizeBlockLinks(filtered);
  const content = takeFirstHeading(makeResourceUrlsAbsolute({ children: normalized, sourceUrl }));
  const title = content.title ?? stripSiteName(metadata.title);

  if (!title) {
    return null;
  }

  const contentRoot: Root = {
    type: "root",
    children: removeRepeatedTitleHeadings({
      children: content.children,
      title: singleLine(title),
    }),
  };
  const markdownTree = await processor.run(contentRoot);
  const body = String(processor.stringify(markdownTree)).trim();

  return buildMarkdownDocument({
    body,
    description: metadata.description,
    sourceUrl,
    title,
  });
}
