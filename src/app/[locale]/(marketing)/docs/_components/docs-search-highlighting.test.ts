import { describe, expect, it } from "vitest";

import {
  createHighlightMatcher,
  splitHighlightedText,
} from "./docs-search-highlighting";

describe("docs search highlighting", () => {
  it("creates a single escaped matcher for meaningful query terms", () => {
    const matcher = createHighlightMatcher("a docs docs? docs? setup");

    expect(matcher.terms).toEqual(["docs?", "setup", "docs"]);
    expect(matcher.pattern?.source).toBe("(docs\\?|setup|docs)");
  });

  it("ignores queries without terms long enough to highlight", () => {
    const matcher = createHighlightMatcher("a b");

    expect(matcher.terms).toEqual([]);
    expect(matcher.pattern).toBeNull();
  });

  it("splits text into case-insensitive highlighted segments", () => {
    const matcher = createHighlightMatcher("docs setup");

    expect(splitHighlightedText({ text: "Docs quick setup", matcher })).toEqual([
      { text: "Docs", highlighted: true },
      { text: " quick ", highlighted: false },
      { text: "setup", highlighted: true },
    ]);
  });
});
