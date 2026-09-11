import { describe, expect, it } from "vitest";
import { EMPTY_TIPTAP_DOC, toEditableTiptapDoc } from "./tiptap-content";

describe("toEditableTiptapDoc", () => {
  it("replaces a document with no children", () => {
    expect(toEditableTiptapDoc({ type: "doc", content: [] })).toBe(EMPTY_TIPTAP_DOC);
  });

  it("replaces a missing or non-object document", () => {
    expect(toEditableTiptapDoc(undefined)).toBe(EMPTY_TIPTAP_DOC);
    expect(toEditableTiptapDoc(null)).toBe(EMPTY_TIPTAP_DOC);
    expect(toEditableTiptapDoc("<p></p>")).toBe(EMPTY_TIPTAP_DOC);
    expect(toEditableTiptapDoc({ type: "doc" })).toBe(EMPTY_TIPTAP_DOC);
  });

  it("keeps a document that has children", () => {
    const content = { type: "doc", content: [{ type: "paragraph" }] };

    expect(toEditableTiptapDoc(content)).toBe(content);
  });

  it("keeps the empty document valid for the block+ content rule", () => {
    expect(EMPTY_TIPTAP_DOC.content).toHaveLength(1);
  });
});
