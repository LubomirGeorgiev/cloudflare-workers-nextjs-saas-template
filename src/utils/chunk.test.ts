// The slicing every bounded caller needs. What matters is that nothing is dropped or reordered.

import { describe, expect, test } from "vitest";

import { chunk } from "@/utils/chunk";

describe("chunk", () => {
  test("splits into consecutive slices of at most `size` and keeps every item", () => {
    expect(chunk({ items: [1, 2, 3, 4, 5], size: 2 })).toEqual([[1, 2], [3, 4], [5]]);
  });

  test("returns one slice when the list fits", () => {
    expect(chunk({ items: ["a", "b"], size: 50 })).toEqual([["a", "b"]]);
  });

  test("returns nothing for an empty list", () => {
    expect(chunk({ items: [], size: 10 })).toEqual([]);
  });

  // The callers pass a `readonly T[]` straight from a query result, and none of them expects that
  // array to change under them.
  test("leaves the source array alone", () => {
    const items = [1, 2, 3];

    chunk({ items, size: 2 });

    expect(items).toEqual([1, 2, 3]);
  });
});
