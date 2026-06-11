import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

describe("/api/get-session route", () => {
  test("does not own public frontend config", () => {
    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

    expect(source).not.toContain("getConfig");
    expect(source).not.toContain("getPublicConfig");
    expect(source).not.toContain("publicConfig");
  });
});
