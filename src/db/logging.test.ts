import { describe, expect, test } from "vitest";

import { shouldLogD1Queries } from "./logging";

describe("D1 query logging", () => {
  test("keeps query logging enabled outside test mode", () => {
    expect(shouldLogD1Queries({ appTestMode: undefined })).toBe(true);
    expect(shouldLogD1Queries({ appTestMode: "false" })).toBe(true);
  });

  test("disables query logging in app test mode", () => {
    expect(shouldLogD1Queries({ appTestMode: "true" })).toBe(false);
  });
});
