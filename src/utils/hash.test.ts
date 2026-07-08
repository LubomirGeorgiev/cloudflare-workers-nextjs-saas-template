import { describe, expect, test } from "vitest";

import { fnv1a } from "@/utils/hash";

describe("fnv1a", () => {
  test("is deterministic for the same input", () => {
    expect(fnv1a("hello world")).toBe(fnv1a("hello world"));
  });

  test("differs for different inputs", () => {
    expect(fnv1a("a")).not.toBe(fnv1a("b"));
  });

  test("distinguishes the empty string from whitespace", () => {
    expect(fnv1a("")).not.toBe(fnv1a(" "));
  });

  test("returns a compact base36 string", () => {
    expect(fnv1a("some longer content here")).toMatch(/^[0-9a-z]+$/);
  });
});
