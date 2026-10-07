import { describe, expect, test } from "vitest";

import { describeEntryDelete } from "./entry-delete-description";

describe("describeEntryDelete", () => {
  test("names no translation when none goes with the entry", () => {
    expect(describeEntryDelete(0)).toBe("This will permanently delete this entry.");
  });

  // "all 1 of its translation" read wrong; one sibling takes the singular, with no count.
  test("uses the singular for one translation", () => {
    const description = describeEntryDelete(1);

    expect(description).toBe("This will permanently delete this entry and its translation.");
    expect(description).not.toContain("all 1");
  });

  test("uses the plural with the count for more than one translation", () => {
    expect(describeEntryDelete(3)).toBe(
      "This will permanently delete this entry and all 3 of its translations.",
    );
  });
});
