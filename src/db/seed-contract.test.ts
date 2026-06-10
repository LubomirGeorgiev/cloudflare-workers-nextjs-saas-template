import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

const documentedSeededAdminEmail = "test@test.com";
const seededMemberEmail = "sarah.chen@example.com";

function readProjectFile(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("seeded user contract", () => {
  test("keeps the documented password user aligned across seed data, helpers, and docs", () => {
    const seedSql = readProjectFile("./seed.sql");
    const authHelpers = readProjectFile("../../tests/e2e/auth-helpers.ts");
    const readme = readProjectFile("../../README.md");

    expect(seedSql).toContain(`'${documentedSeededAdminEmail}'`);
    expect(seedSql).toContain(`'${seededMemberEmail}'`);
    expect(authHelpers).toContain(`email: "${seededMemberEmail}"`);
    expect(readme).toContain(`${documentedSeededAdminEmail} / password`);
  });
});
