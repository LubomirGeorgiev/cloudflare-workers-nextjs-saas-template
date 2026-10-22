/**
 * Identifiers from `src/db/seed.sql` that more than one E2E spec asserts on. Reseeding with
 * different content should be a single edit here, and `src/db/seed-contract.test.ts` fails
 * fast (in unit tests) when these drift out of the seed file.
 */

export const SEEDED_BLOG_AUTHOR = {
  id: "usr_lyo1up6a9q75dmpv3o5x9irj",
  firstName: "Test",
  lastName: "Testov",
  publishedPostCount: 7,
  otherPostTitle: "Serverless Architecture Patterns",
} as const;

export const SEEDED_BLOG_ENTRY = {
  id: "cms_ent_test001",
  slug: "getting-started-with-nextjs-15",
  title: "Getting Started with Next.js 15",
  authorName: `${SEEDED_BLOG_AUTHOR.firstName} ${SEEDED_BLOG_AUTHOR.lastName}`,
  tagNames: ["Next.js", "React", "TypeScript"],
  contentHeadings: ["Build Your First Next.js 15 Page", "Starter Project Checklist"],
} as const;

export const SEEDED_BLOG_ENTRY_PATH = `/blog/${SEEDED_BLOG_ENTRY.slug}`;

// The seed orders posts by publish date, so this one lands on the second list page.
export const SEEDED_BLOG_PAGE_TWO_TITLE = "Advanced Git Workflows for Teams";

export const SEEDED_BLOG_TAG = {
  id: "ctag_test004",
  slug: "cloudflare",
  name: "Cloudflare",
  postCount: 3,
  postTitles: [
    "Building Scalable APIs with Cloudflare Workers",
    "Optimizing Web Performance with Edge Computing",
  ],
} as const;

export const SEEDED_DOCS_ENTRY = {
  id: "cms_ent_docs001",
  slug: "introduction",
  title: "Introduction",
  categorySlug: "getting-started",
  categoryTitle: "Getting Started",
  introText: "Learn how this template is structured and how to ship your first feature quickly.",
  listItemText: "Authentication and team management",
} as const;

export const SEEDED_DOCS_ENTRY_PATH = `/docs/${SEEDED_DOCS_ENTRY.categorySlug}/${SEEDED_DOCS_ENTRY.slug}`;

export const SEEDED_AUTH_DOCS_ENTRY = {
  id: "cms_ent_docs002",
  title: "Authentication Setup",
} as const;

// A seeded navigation redirect whose target is `SEEDED_DOCS_ENTRY_PATH`.
export const SEEDED_DOCS_REDIRECT_FROM_PATH = "/docs/getting-started/setup";
