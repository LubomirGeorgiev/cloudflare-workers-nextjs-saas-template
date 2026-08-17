import { describe, expect, test } from "vitest";

import { buildMarkdownDocument, singleLine } from "./markdown-document";

describe("singleLine", () => {
  test("collapses every whitespace run and trims the ends", () => {
    expect(singleLine("  Ship  your\tSaaS\n\nto the edge.  ")).toBe("Ship your SaaS to the edge.");
  });

  test("returns an empty string for whitespace-only input", () => {
    expect(singleLine(" \n\t ")).toBe("");
  });
});

describe("buildMarkdownDocument", () => {
  test("writes the full frame", () => {
    expect(
      buildMarkdownDocument({
        body: "## Details\n\nBody copy.",
        description: "A  complete\nsummary.",
        metadataLines: ["Author: Ada Lovelace", "Tags: Engineering"],
        sourceUrl: "https://example.com/blog/release-notes",
        title: "Release  notes",
      }),
    ).toBe(
      "# Release notes\n\nA complete summary.\n\nSource: https://example.com/blog/release-notes\n"
      + "Author: Ada Lovelace\nTags: Engineering\n\n## Details\n\nBody copy.\n",
    );
  });

  test("drops the description block when the description collapses to nothing", () => {
    expect(
      buildMarkdownDocument({
        body: "Body copy.",
        description: "   ",
        sourceUrl: "https://example.com/terms",
        title: "Terms of Service",
      }),
    ).toBe("# Terms of Service\n\nSource: https://example.com/terms\n\nBody copy.\n");
  });

  test("drops the body block when there is no body", () => {
    expect(
      buildMarkdownDocument({
        body: "",
        sourceUrl: "https://example.com/terms",
        title: "Terms of Service",
      }),
    ).toBe("# Terms of Service\n\nSource: https://example.com/terms\n");
  });
});
