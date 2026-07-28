import { beforeEach, describe, expect, test, vi } from "vitest";
import type { JSONContent } from "@tiptap/core";

// translate-entry is server-only and imports the Cloudflare context; stub both so
// the pure extract/reinject logic can be exercised in the node test environment.
vi.mock("server-only", () => ({}));
vi.mock("@/utils/cloudflare-context", () => ({
  getCloudflareContext: vi.fn(),
}));
vi.mock("@/lib/ai/generate-text", () => ({
  runAiText: vi.fn(),
}));

import { getCloudflareContext } from "@/utils/cloudflare-context";
import { runAiText } from "@/lib/ai/generate-text";
import { CMS_SEO_DESCRIPTION_MAX_LENGTH } from "@/constants";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/config";
import {
  collectTranslatableStrings,
  reconcileTranslation,
  translateContent,
  translateEntryFields,
  translateTagFields,
  translateText,
} from "@/lib/cms/translate-entry";

const getCloudflareContextMock = vi.mocked(getCloudflareContext);
const runAiTextMock = vi.mocked(runAiText);

function buildDoc(): JSONContent {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Hello" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "This is " },
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "text", text: " and a " },
          {
            type: "text",
            text: "link",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
          { type: "text", text: "." },
        ],
      },
      { type: "image", attrs: { src: "/api/cms-images/cat.png", alt: "a cat" } },
      { type: "alertBlock", attrs: { title: "Note", body: "Be careful", variant: "info" } },
      { type: "codeBlock", content: [{ type: "text", text: "const x = 1;" }] },
      { type: "paragraph", content: [{ type: "text", text: "inline", marks: [{ type: "code" }] }] },
    ],
  };
}

const identity = async (values: string[]) => values;
const uppercase = async (values: string[]) => values.map((value) => value.toUpperCase());

beforeEach(() => {
  vi.clearAllMocks();
  // The failure paths log via console.error by design; keep test output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function mockAiContext(): void {
  getCloudflareContextMock.mockResolvedValue({
    env: { AI: {} },
  } as Awaited<ReturnType<typeof getCloudflareContext>>);
}

function mockTranslatedValues(values: string[]): void {
  runAiTextMock.mockResolvedValue(JSON.stringify(values));
}

// Per-chunk translator: parses the input array out of the prompt (it is the trailing JSON array after
// "Input:") and uppercases each string. Because each chunk is a separate runAiText call, this lets
// multi-chunk ordering be checked end to end — the reassembled output must uppercase every value in source order.
function uppercaseChunk(prompt: string): string {
  const arr = JSON.parse(prompt.slice(prompt.indexOf("["))) as string[];
  return JSON.stringify(arr.map((value) => value.toUpperCase()));
}

function mockAiUppercasePerChunk(): void {
  runAiTextMock.mockImplementation(async ({ prompt }) => uppercaseChunk(prompt));
}

function buildLongDoc(texts: string[]): JSONContent {
  return {
    type: "doc",
    content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  };
}

function contentTexts(content: JSONContent): Array<string | undefined> {
  return (content.content ?? []).map((node) => node.content?.[0].text);
}

// Driven off the app locale config so renaming or dropping a locale cannot strand these
// tests. Cross-locale cases are skipped on single-locale forks, where translation no-ops.
const TARGET_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE) as Locale;

describe("collectTranslatableStrings", () => {
  test("collects text, image alt, and alert title/body, skipping code", () => {
    const { values } = collectTranslatableStrings(buildDoc());
    expect(values).toEqual([
      "Hello",
      "This is ",
      "bold",
      " and a ",
      "link",
      ".",
      "a cat",
      "Note",
      "Be careful",
    ]);
  });
});

describe("translateContent", () => {
  test("identity translation is deep-equal to the source and does not mutate it", async () => {
    const source = buildDoc();
    const result = await translateContent({ content: source, translate: identity });
    expect(result).toEqual(buildDoc());
    // Source untouched (deep clone under the hood).
    expect(source).toEqual(buildDoc());
  });

  test("only translatable leaf strings change; structure is preserved", async () => {
    const result = await translateContent({ content: buildDoc(), translate: uppercase });
    const content = result.content ?? [];

    // Same number and order of nodes/types.
    expect(content.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "image",
      "alertBlock",
      "codeBlock",
      "paragraph",
    ]);

    // Text and alt/title/body translated.
    expect(content[0].content?.[0].text).toBe("HELLO");
    expect((content[2].attrs as Record<string, unknown>).alt).toBe("A CAT");
    expect((content[3].attrs as Record<string, unknown>).title).toBe("NOTE");
    expect((content[3].attrs as Record<string, unknown>).body).toBe("BE CAREFUL");

    // Marks and link href untouched.
    const paragraph = content[1].content ?? [];
    expect(paragraph[1].marks).toEqual([{ type: "bold" }]);
    expect(paragraph[3].marks?.[0].attrs?.href).toBe("https://example.com");

    // Image src untouched.
    expect((content[2].attrs as Record<string, unknown>).src).toBe("/api/cms-images/cat.png");

    // Code block text and inline `code` mark text are NOT translated.
    expect(content[4].content?.[0].text).toBe("const x = 1;");
    expect(content[5].content?.[0].text).toBe("inline");
  });

  test("a wrong-length translation response falls back to a verbatim copy", async () => {
    const dropAll = async () => [] as string[];
    const result = await translateContent({ content: buildDoc(), translate: dropAll });
    expect(result).toEqual(buildDoc());
  });
});

describe("reconcileTranslation", () => {
  test("returns the candidate when it is a same-length string array", () => {
    expect(reconcileTranslation(["a", "b"], ["x", "y"])).toEqual(["x", "y"]);
  });

  test("falls back to the source on length mismatch or non-array", () => {
    expect(reconcileTranslation(["a", "b"], ["x"])).toEqual(["a", "b"]);
    expect(reconcileTranslation(["a", "b"], "nope")).toEqual(["a", "b"]);
  });

  test("keeps the source string for any non-string item", () => {
    expect(reconcileTranslation(["a", "b"], ["x", 5])).toEqual(["x", "b"]);
  });
});

describe.skipIf(!TARGET_LOCALE)("translateEntryFields", () => {
  test("maps named fields and content translations without shifting blank fields", async () => {
    mockAiContext();
    mockTranslatedValues(["Descripcion traducida", "Contenido traducido"]);

    const result = await translateEntryFields({
      title: "",
      seoDescription: "Source description",
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Source content" }] }],
      },
      sourceLocale: DEFAULT_LOCALE,
      targetLocale: TARGET_LOCALE,
    });

    expect(result.title).toBe("");
    expect(result.seoDescription).toBe("Descripcion traducida");
    expect(result.content.content?.[0].content?.[0].text).toBe("Contenido traducido");
    expect(result.translated).toBe(true);
  });

  test("truncates translated SEO descriptions through the shared helper", async () => {
    mockAiContext();
    mockTranslatedValues(["x".repeat(200)]);

    const result = await translateEntryFields({
      title: "",
      seoDescription: "Source description",
      content: { type: "doc", content: [] },
      sourceLocale: DEFAULT_LOCALE,
      targetLocale: TARGET_LOCALE,
    });

    expect(result.seoDescription).toHaveLength(CMS_SEO_DESCRIPTION_MAX_LENGTH);
    expect(result.seoDescription?.endsWith("...")).toBe(true);
  });

  test("only translates the requested fields, leaving others verbatim", async () => {
    mockAiContext();
    mockAiUppercasePerChunk();

    const result = await translateEntryFields({
      title: "hello title",
      seoDescription: "keep me",
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "keep body" }] }],
      },
      sourceLocale: DEFAULT_LOCALE,
      targetLocale: TARGET_LOCALE,
      only: ["title"],
    });

    expect(result.title).toBe("HELLO TITLE");
    // SEO + body are returned untouched and never leave for the model.
    expect(result.seoDescription).toBe("keep me");
    expect(result.content.content?.[0].content?.[0].text).toBe("keep body");
    expect(runAiTextMock).toHaveBeenCalledTimes(1);
    const { prompt } = runAiTextMock.mock.calls[0][0];
    expect(prompt).toContain("hello title");
    expect(prompt).not.toContain("keep body");
  });
});

describe.skipIf(!TARGET_LOCALE)("translateText", () => {
  test("uses the shared AI guard and named-field translation path", async () => {
    mockAiContext();
    mockTranslatedValues(["Etiqueta"]);

    const result = await translateText({
      text: "Label",
      sourceLocale: DEFAULT_LOCALE,
      targetLocale: TARGET_LOCALE,
    });

    expect(result).toEqual({ text: "Etiqueta", translated: true });
  });
});

describe.skipIf(!TARGET_LOCALE)("translateTagFields", () => {
  test("keeps blank tag names from shifting the description translation", async () => {
    mockAiContext();
    mockTranslatedValues(["Descripcion de etiqueta"]);

    const result = await translateTagFields({
      name: "",
      description: "Tag description",
      sourceLocale: DEFAULT_LOCALE,
      targetLocale: TARGET_LOCALE,
    });

    expect(result).toEqual({
      name: "",
      description: "Descripcion de etiqueta",
      translated: true,
    });
  });
});

describe.skipIf(!TARGET_LOCALE)("translateEntryFields chunking", () => {
  test("reassembles multi-batch chunked content in source order", async () => {
    mockAiContext();
    mockAiUppercasePerChunk();

    // 170 items → 5 chunks of ≤40 → 2 concurrency batches (4 + 1), exercising both
    // the per-chunk split and the cross-batch reassembly ordering.
    const texts = Array.from({ length: 170 }, (_, index) => `s${index}`);

    const result = await translateEntryFields({
      title: "",
      seoDescription: null,
      content: buildLongDoc(texts),
      sourceLocale: DEFAULT_LOCALE,
      targetLocale: TARGET_LOCALE,
    });

    expect(runAiTextMock).toHaveBeenCalledTimes(5);
    expect(contentTexts(result.content)).toEqual(texts.map((text) => text.toUpperCase()));
    expect(result.translated).toBe(true);
  });

  test("splits on the character budget, not just item count", async () => {
    mockAiContext();
    mockAiUppercasePerChunk();

    // 4 × 1000 chars = 4000 > 3000-char budget → 2 chunks even though item count
    // (4) is far under the 40-item limit.
    const texts = Array.from({ length: 4 }, (_, index) => `${index}`.repeat(1000));

    const result = await translateEntryFields({
      title: "",
      seoDescription: null,
      content: buildLongDoc(texts),
      sourceLocale: DEFAULT_LOCALE,
      targetLocale: TARGET_LOCALE,
    });

    expect(runAiTextMock).toHaveBeenCalledTimes(2);
    expect(contentTexts(result.content)).toEqual(texts.map((text) => text.toUpperCase()));
    expect(result.translated).toBe(true);
  });

  test("one failing chunk copies verbatim while siblings translate (translated: false)", async () => {
    mockAiContext();
    // First chunk (items 0–39) throws → verbatim copy; the rest translate normally.
    runAiTextMock
      .mockRejectedValueOnce(new Error("chunk timeout"))
      .mockImplementation(async ({ prompt }) => uppercaseChunk(prompt));

    const texts = Array.from({ length: 50 }, (_, index) => `s${index}`);

    const result = await translateEntryFields({
      title: "",
      seoDescription: null,
      content: buildLongDoc(texts),
      sourceLocale: DEFAULT_LOCALE,
      targetLocale: TARGET_LOCALE,
    });

    const outputs = contentTexts(result.content);
    // Failed chunk: source strings untouched.
    expect(outputs[0]).toBe("s0");
    expect(outputs[39]).toBe("s39");
    // Sibling chunk: translated.
    expect(outputs[40]).toBe("S40");
    expect(outputs[49]).toBe("S49");
    // A partial/verbatim result is flagged as not fully translated.
    expect(result.translated).toBe(false);
  });
});

describe("withAiTranslation fallbacks", () => {
  test("same-locale request skips the AI entirely and returns the source", async () => {
    const result = await translateText({
      text: "Label",
      sourceLocale: DEFAULT_LOCALE,
      targetLocale: DEFAULT_LOCALE,
    });

    expect(result).toEqual({ text: "Label", translated: false });
    expect(getCloudflareContextMock).not.toHaveBeenCalled();
    expect(runAiTextMock).not.toHaveBeenCalled();
  });

  test("missing AI binding falls back to the untouched entry", async () => {
    getCloudflareContextMock.mockResolvedValue({
      env: {},
    } as Awaited<ReturnType<typeof getCloudflareContext>>);

    const content: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Source content" }] }],
    };

    const result = await translateEntryFields({
      title: "Source title",
      seoDescription: "Source description",
      content,
      sourceLocale: DEFAULT_LOCALE,
      targetLocale: TARGET_LOCALE,
    });

    expect(result).toEqual({
      title: "Source title",
      seoDescription: "Source description",
      content,
      translated: false,
    });
    expect(runAiTextMock).not.toHaveBeenCalled();
  });
});
