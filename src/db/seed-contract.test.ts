import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { SEEDED_BLOG_ENTRY, SEEDED_DOCS_ENTRY } from "../../tests/e2e/seed-fixtures";

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
    expect(authHelpers).toContain(`SEEDED_ADMIN_EMAIL = "${documentedSeededAdminEmail}"`);
    expect(authHelpers).toContain(`SEEDED_MEMBER_EMAIL = "${seededMemberEmail}"`);
    expect(readme).toContain(`${documentedSeededAdminEmail} / password`);
  });
});

describe("seeded CMS content contract", () => {
  // The E2E specs assert on these through `tests/e2e/seed-fixtures.ts`. Catching drift here
  // fails in milliseconds with the offending value, instead of as an E2E locator timeout.
  test("keeps the shared CMS fixtures aligned with the seed data", () => {
    const seedSql = readProjectFile("./seed.sql");

    for (const value of [
      SEEDED_BLOG_ENTRY.id,
      SEEDED_BLOG_ENTRY.slug,
      SEEDED_BLOG_ENTRY.title,
      SEEDED_BLOG_ENTRY.authorName,
      SEEDED_DOCS_ENTRY.id,
      SEEDED_DOCS_ENTRY.slug,
      SEEDED_DOCS_ENTRY.title,
      SEEDED_DOCS_ENTRY.categorySlug,
    ]) {
      expect(seedSql).toContain(value);
    }
  });
});
