/**
 * Identifiers from `src/db/seed.sql` that more than one E2E spec asserts on. Reseeding with
 * different content should be a single edit here, and `src/db/seed-contract.test.ts` fails
 * fast (in unit tests) when these drift out of the seed file.
 */

export const SEEDED_BLOG_ENTRY = {
  id: "cms_ent_test001",
  slug: "getting-started-with-nextjs-15",
  title: "Getting Started with Next.js 15",
  authorName: "Test Testov",
} as const;

export const SEEDED_BLOG_ENTRY_PATH = `/blog/${SEEDED_BLOG_ENTRY.slug}`;

export const SEEDED_DOCS_ENTRY = {
  id: "cms_ent_docs001",
  slug: "introduction",
  title: "Introduction",
  categorySlug: "getting-started",
} as const;

export const SEEDED_DOCS_ENTRY_PATH = `/docs/${SEEDED_DOCS_ENTRY.categorySlug}/${SEEDED_DOCS_ENTRY.slug}`;
