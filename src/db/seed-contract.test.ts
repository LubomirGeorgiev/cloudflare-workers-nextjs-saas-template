import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  SEEDED_AUTH_DOCS_ENTRY,
  SEEDED_BLOG_AUTHOR,
  SEEDED_BLOG_ENTRY,
  SEEDED_BLOG_PAGE_TWO_TITLE,
  SEEDED_BLOG_TAG,
  SEEDED_DOCS_ENTRY,
  SEEDED_DOCS_REDIRECT_FROM_PATH,
} from "../../tests/e2e/seed-fixtures";

const documentedSeededAdminEmail = "test@test.com";
const seededMemberEmail = "sarah.chen@example.com";

function readProjectFile(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function countSeedRows({ seedSql, pattern }: { seedSql: string; pattern: RegExp }): number {
  return seedSql.split("\n").filter((line) => pattern.test(line)).length;
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
      SEEDED_BLOG_AUTHOR.id,
      SEEDED_BLOG_AUTHOR.firstName,
      SEEDED_BLOG_AUTHOR.lastName,
      SEEDED_BLOG_AUTHOR.otherPostTitle,
      SEEDED_BLOG_ENTRY.id,
      SEEDED_BLOG_ENTRY.slug,
      SEEDED_BLOG_ENTRY.title,
      ...SEEDED_BLOG_ENTRY.tagNames,
      ...SEEDED_BLOG_ENTRY.contentHeadings,
      SEEDED_BLOG_PAGE_TWO_TITLE,
      SEEDED_BLOG_TAG.id,
      SEEDED_BLOG_TAG.slug,
      SEEDED_BLOG_TAG.name,
      ...SEEDED_BLOG_TAG.postTitles,
      SEEDED_DOCS_ENTRY.id,
      SEEDED_DOCS_ENTRY.slug,
      SEEDED_DOCS_ENTRY.title,
      SEEDED_DOCS_ENTRY.categorySlug,
      SEEDED_DOCS_ENTRY.categoryTitle,
      SEEDED_DOCS_ENTRY.introText,
      SEEDED_DOCS_ENTRY.listItemText,
      SEEDED_AUTH_DOCS_ENTRY.id,
      SEEDED_AUTH_DOCS_ENTRY.title,
      SEEDED_DOCS_REDIRECT_FROM_PATH,
    ]) {
      expect(seedSql).toContain(value);
    }
  });

  // The blog pages render these counts, so a reseed that moves a post must update the fixture.
  test("keeps the shared blog post counts aligned with the seed rows", () => {
    const seedSql = readProjectFile("./seed.sql");

    expect(
      countSeedRows({
        seedSql,
        pattern: new RegExp(
          `^\\s*\\('cms_ent_\\w+', 'blog', .*'published', \\d+, '${SEEDED_BLOG_AUTHOR.id}'`
        ),
      })
    ).toBe(SEEDED_BLOG_AUTHOR.publishedPostCount);
    expect(
      countSeedRows({
        seedSql,
        pattern: new RegExp(`^\\s*\\('cet_\\w+', 'cms_ent_\\w+', '${SEEDED_BLOG_TAG.id}'`),
      })
    ).toBe(SEEDED_BLOG_TAG.postCount);
  });
});
