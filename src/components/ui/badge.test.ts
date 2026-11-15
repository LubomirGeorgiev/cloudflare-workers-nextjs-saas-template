import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { Badge, badgeVariants } from "@/components/ui/badge";

describe("Badge", () => {
  // Callers put a Badge inside <p>; a block element there breaks hydration.
  test("renders a span, so it is valid inside a paragraph", () => {
    const html = renderToStaticMarkup(
      createElement("p", null, createElement(Badge, { variant: "secondary" }, "label"))
    );

    expect(html).toMatch(/^<p><span class="[^"]*">label<\/span><\/p>$/);
    expect(html).toContain(badgeVariants({ variant: "secondary" }));
  });
});
