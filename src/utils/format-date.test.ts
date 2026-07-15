import { describe, expect, test } from "vitest";

import { formatDate, formatDateTime } from "./format-date";

describe("formatDate", () => {
  test("formats with the requested locale", () => {
    const date = new Date("2024-06-15T12:00:00.000Z");

    expect(formatDate(date, "en")).toBe("Jun 15, 2024");
    expect(formatDate(date, "es")).toMatch(/15/);
    expect(formatDate(date, "es")).not.toBe(formatDate(date, "en"));
  });
});

describe("formatDateTime", () => {
  test("formats with the requested locale", () => {
    const date = new Date("2024-06-15T12:00:00.000Z");

    expect(formatDateTime(date, "en")).toContain("2024");
    expect(formatDateTime(date, "es")).toContain("2024");
    expect(formatDateTime(date, "es")).not.toBe(formatDateTime(date, "en"));
  });
});
