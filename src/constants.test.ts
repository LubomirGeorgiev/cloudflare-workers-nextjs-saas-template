import { describe, expect, test } from "vitest";

import {
  ADMIN_TABLE_PAGE_SIZE_OPTIONS,
  DEFAULT_ADMIN_TABLE_PAGE_SIZE,
  MAX_ADMIN_TABLE_PAGE_SIZE,
} from "./constants";

describe("admin table pagination contract", () => {
  test("the dropdown options stay within the server-accepted range", () => {
    for (const option of ADMIN_TABLE_PAGE_SIZE_OPTIONS) {
      expect(option).toBeGreaterThanOrEqual(1);
      expect(option).toBeLessThanOrEqual(MAX_ADMIN_TABLE_PAGE_SIZE);
    }
  });

  test("the default and max page sizes are both selectable in the dropdown", () => {
    expect(ADMIN_TABLE_PAGE_SIZE_OPTIONS).toContain(DEFAULT_ADMIN_TABLE_PAGE_SIZE);
    expect(ADMIN_TABLE_PAGE_SIZE_OPTIONS).toContain(MAX_ADMIN_TABLE_PAGE_SIZE);
  });
});
