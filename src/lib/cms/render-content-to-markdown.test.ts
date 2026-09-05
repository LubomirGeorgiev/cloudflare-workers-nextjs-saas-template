import type { JSONContent } from "@tiptap/core";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { renderContentToMarkdown } = await import("./render-content-to-markdown");

const FENCE = "`".repeat(3);
const LONG_FENCE = "`".repeat(5);

function paragraphDoc(content: JSONContent[]): JSONContent {
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

/** Pass `attrs: null` to build a code block with no `attrs` key at all. */
function codeBlockDoc({ text, attrs = { language: "text" } }: {
  text?: string;
  attrs?: JSONContent["attrs"] | null;
}): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "codeBlock",
        ...(attrs ? { attrs } : {}),
        ...(text === undefined ? {} : { content: [{ type: "text", text }] }),
      },
    ],
  };
}

/** Split a fenced block and fail if the fence does not hold: no inner line may close it. */
function parseFencedBlock(markdown: string): { fence: string; language: string; body: string } {
  const lines = markdown.split("\n");
  const fence = lines[0]?.match(/^`+/)?.[0] ?? "";

  expect(fence.length).toBeGreaterThanOrEqual(3);
  expect(lines.at(-1)).toBe(fence);

  const body = lines.slice(1, -1);
  const closingLine = new RegExp(`^ {0,3}\`{${fence.length},}\\s*$`);

  for (const line of body) {
    expect(line).not.toMatch(closingLine);
  }

  return { fence, language: lines[0].slice(fence.length), body: body.join("\n") };
}

describe("renderContentToMarkdown", () => {
  test("keeps text around an incomplete image upload", () => {
    const markdown = renderContentToMarkdown({ type: "doc", content: [
      { type: "imageUpload" },
      { type: "paragraph", content: [{ type: "text", text: "Keep this text." }] },
    ] });

    expect(markdown.trim()).toBe("Keep this text.");
  });

  test("keeps repeated equals signs in prose literal", () => {
    const markdown = renderContentToMarkdown(paragraphDoc([{ type: "text", text: "a == b == c" }]));

    expect(markdown).toContain("a == b == c");
    expect(markdown).not.toContain("<mark>");
  });

  test("keeps repeated plus signs in prose literal", () => {
    const markdown = renderContentToMarkdown(
      paragraphDoc([{ type: "text", text: "C++ and C++" }]),
    );

    expect(markdown).toContain("C++ and C++");
    expect(markdown).not.toContain("<u>");
  });

  test("keeps an inline code span literal", () => {
    const markdown = renderContentToMarkdown(
      paragraphDoc([
        { type: "text", text: "compare with " },
        { type: "text", text: "a == b and C++", marks: [{ type: "code" }] },
      ]),
    );

    expect(markdown).toContain("`a == b and C++`");
    expect(markdown).not.toContain("<mark>");
    expect(markdown).not.toContain("<u>");
  });

  test("keeps a fence-like line inside a code block literal", () => {
    const markdown = renderContentToMarkdown({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "text" },
          content: [{ type: "text", text: "~~~\na == b == c\nC++ and C++" }],
        },
      ],
    });

    expect(markdown).toContain("a == b == c");
    expect(markdown).toContain("C++ and C++");
    expect(markdown).not.toContain("<mark>");
    expect(markdown).not.toContain("<u>");
  });

  test("serializes highlight and underline marks as HTML", () => {
    const markdown = renderContentToMarkdown(
      paragraphDoc([
        { type: "text", text: "before " },
        { type: "text", text: "lit", marks: [{ type: "highlight" }] },
        { type: "text", text: " and " },
        { type: "text", text: "lined", marks: [{ type: "underline" }] },
        { type: "text", text: " after" },
      ]),
    );

    expect(markdown).toContain("<mark>lit</mark>");
    expect(markdown).toContain("<u>lined</u>");
    expect(markdown).not.toContain("==lit==");
    expect(markdown).not.toContain("++lined++");
  });

  test("serializes a colored highlight and stacked marks as HTML", () => {
    const markdown = renderContentToMarkdown(
      paragraphDoc([
        {
          type: "text",
          text: "both",
          marks: [
            { type: "highlight", attrs: { color: "#ff0000" } },
            { type: "underline" },
          ],
        },
      ]),
    );

    expect(markdown).toContain("both");
    expect(markdown).toMatch(/<(mark|u)><(mark|u)>both<\/(mark|u)><\/(mark|u)>/);
  });

  test("keeps a three-backtick fence when the code block holds no backtick", () => {
    const markdown = renderContentToMarkdown(
      codeBlockDoc({ text: "const a = 1;\nconst b = 2;", attrs: { language: "ts" } }),
    );

    expect(markdown).toBe(`${FENCE}ts\nconst a = 1;\nconst b = 2;\n${FENCE}`);
  });

  test("grows the fence past a three-backtick line inside the code block", () => {
    const text = `line one\n${FENCE}\nline two`;
    const markdown = renderContentToMarkdown(codeBlockDoc({ text }));
    const { fence, language, body } = parseFencedBlock(markdown);

    expect(fence).toBe("`".repeat(4));
    expect(language).toBe("text");
    expect(body).toBe(text);
    expect(markdown).toBe(`${fence}text\n${text}\n${fence}`);
  });

  test("grows the fence past a longer backtick run inside the code block", () => {
    const text = `before\n${LONG_FENCE}\nafter`;
    const markdown = renderContentToMarkdown(codeBlockDoc({ text }));
    const { fence, body } = parseFencedBlock(markdown);

    expect(fence).toBe("`".repeat(6));
    expect(body).toBe(text);
  });

  test("grows the fence past an indented fence-like line", () => {
    const text = `before\n  ${FENCE}\nafter`;
    const markdown = renderContentToMarkdown(codeBlockDoc({ text }));
    const { fence, body } = parseFencedBlock(markdown);

    expect(fence).toBe("`".repeat(4));
    expect(body).toBe(text);
  });

  test("grows the fence past an inline backtick run without a line of its own", () => {
    const text = `call ${FENCE}nested${FENCE} here`;
    const markdown = renderContentToMarkdown(codeBlockDoc({ text }));
    const { fence, body } = parseFencedBlock(markdown);

    expect(fence).toBe("`".repeat(4));
    expect(body).toBe(text);
  });

  test("keeps the empty code block output unchanged", () => {
    expect(renderContentToMarkdown(codeBlockDoc({}))).toBe(`${FENCE}text\n\n${FENCE}`);
  });

  test("omits the info string when the language is null or absent", () => {
    const nullLanguage = renderContentToMarkdown(
      codeBlockDoc({ text: "plain", attrs: { language: null } }),
    );
    const noAttrs = renderContentToMarkdown(codeBlockDoc({ text: "plain", attrs: null }));

    expect(nullLanguage).toBe(`${FENCE}\nplain\n${FENCE}`);
    expect(noAttrs).toBe(`${FENCE}\nplain\n${FENCE}`);
  });

  test("keeps a code block inside a document byte-identical", () => {
    const markdown = renderContentToMarkdown({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [{ type: "text", text: "const a = 1;" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    });

    expect(markdown).toBe(`before\n\n${FENCE}ts\nconst a = 1;\n${FENCE}\n\nafter`);
  });
});
