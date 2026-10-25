import { describe, expect, it } from "vitest";

import { getValidPageNumber } from "./get-valid-page-number";

describe("getValidPageNumber", () => {
  it("accepts a positive integer as a string or a number", () => {
    expect(getValidPageNumber({ value: "2" })).toBe(2);
    expect(getValidPageNumber({ value: 3 })).toBe(3);
  });

  it("rejects zero, negatives, fractions, and NaN", () => {
    for (const value of [0, -1, 1.5, Number.NaN, "0", "-1", "1.5"]) {
      expect(getValidPageNumber({ value })).toBeNull();
    }
  });

  it("rejects values that are not numbers", () => {
    for (const value of ["abc", "", " ", null, undefined, {}]) {
      expect(getValidPageNumber({ value })).toBeNull();
    }
  });
});
