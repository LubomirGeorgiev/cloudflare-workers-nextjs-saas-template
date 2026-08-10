import { describe, expect, it } from "vitest";

import { escapeHtml } from "./escape-html";

describe("escapeHtml", () => {
  it("escapes every character that can break out of markup or an attribute", () => {
    expect(escapeHtml(`<a href='x' title="y">A & B</a>`)).toBe(
      "&lt;a href=&#39;x&#39; title=&quot;y&quot;&gt;A &amp; B&lt;/a&gt;"
    );
  });

  it("escapes the ampersand first, so an entity is not double-encoded into a literal", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves plain text unchanged", () => {
    expect(escapeHtml("Ana Müller")).toBe("Ana Müller");
  });
});
