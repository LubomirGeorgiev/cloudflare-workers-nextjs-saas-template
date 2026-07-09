import { describe, expect, test, vi } from "vitest";
import type { JSONContent } from "@tiptap/core";

// translation-staleness is server-only and pulls in translate-entry (also
// server-only, which imports the Cloudflare context + AI binding). Stub them so the
// pure hashing logic runs in the node test environment.
vi.mock("server-only", () => ({}));
vi.mock("@/utils/cloudflare-context", () => ({ getCloudflareContext: vi.fn() }));
vi.mock("@/lib/ai/generate-text", () => ({ runAiText: vi.fn() }));

import {
  computeEntryTranslatableHashes,
  computeStaleFields,
} from "@/lib/cms/translation-staleness";

function doc(text: string): JSONContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

const base = { title: "Title", seoDescription: "Desc", content: doc("Body") };

describe("computeEntryTranslatableHashes", () => {
  test("is stable for identical input", () => {
    expect(computeEntryTranslatableHashes(base)).toEqual(computeEntryTranslatableHashes(base));
  });

  test("treats a null SEO description like an empty one", () => {
    const withNull = computeEntryTranslatableHashes({ ...base, seoDescription: null });
    const withEmpty = computeEntryTranslatableHashes({ ...base, seoDescription: "" });
    expect(withNull.seoDescription).toBe(withEmpty.seoDescription);
  });

  test("changes only the hash of the field whose translatable text changed", () => {
    const original = computeEntryTranslatableHashes(base);
    const titleChanged = computeEntryTranslatableHashes({ ...base, title: "New title" });
    expect(titleChanged.title).not.toBe(original.title);
    expect(titleChanged.content).toBe(original.content);
    expect(titleChanged.seoDescription).toBe(original.seoDescription);
  });

  test("ignores non-translatable content changes (image src, code)", () => {
    const withCode: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
        { type: "image", attrs: { src: "/a.png", alt: "" } },
        { type: "codeBlock", content: [{ type: "text", text: "const x = 1;" }] },
      ],
    };
    const withCodeChanged: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
        { type: "image", attrs: { src: "/b.png", alt: "" } },
        { type: "codeBlock", content: [{ type: "text", text: "const y = 2;" }] },
      ],
    };
    const a = computeEntryTranslatableHashes({ ...base, content: withCode });
    const b = computeEntryTranslatableHashes({ ...base, content: withCodeChanged });
    expect(a.content).toBe(b.content);
  });
});

describe("computeStaleFields", () => {
  const current = computeEntryTranslatableHashes(base);

  test("returns [] when there is no snapshot baseline", () => {
    expect(computeStaleFields({ snapshot: null, current })).toEqual([]);
  });

  test("returns [] when the snapshot matches the source", () => {
    expect(computeStaleFields({ snapshot: current, current })).toEqual([]);
  });

  test("flags exactly the fields that drifted", () => {
    const snapshot = computeEntryTranslatableHashes({
      ...base,
      title: "Old title",
      content: doc("Old body"),
    });
    expect(computeStaleFields({ snapshot, current }).sort()).toEqual(["content", "title"]);
  });
});
