import { describe, expect, it } from "vitest";

import { countVisibleOptions } from "@/components/ui/multi-select";

describe("countVisibleOptions", () => {
  it("returns zero for an empty search result", () => {
    expect(countVisibleOptions([])).toBe(0);
  });

  it("counts flat options", () => {
    expect(
      countVisibleOptions([
        { label: "A", value: "a" },
        { label: "B", value: "b" },
      ])
    ).toBe(2);
  });

  it("counts the options inside groups, not the groups", () => {
    expect(
      countVisibleOptions([
        { heading: "One", options: [{ label: "A", value: "a" }] },
        { heading: "Two", options: [] },
      ])
    ).toBe(1);
  });
});
