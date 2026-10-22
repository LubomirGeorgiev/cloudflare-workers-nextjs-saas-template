import { expect, test } from "vitest";
import {
  expectAppPathname,
  expectAppRole,
  expectAppText,
  expectNoAppText,
  fetchAppPath,
  loadAppFrame,
} from "./app-frame";
import {
  SEEDED_BLOG_AUTHOR,
  SEEDED_BLOG_ENTRY,
  SEEDED_BLOG_ENTRY_PATH,
  SEEDED_BLOG_PAGE_TWO_TITLE,
  SEEDED_BLOG_TAG,
} from "./seed-fixtures";
import { DEFAULT_LOCALE } from "../../src/i18n/config";
import { getTranslator } from "../../src/i18n/translator";
import { getBlogAuthorPagePath, getBlogTagPagePath } from "../../src/lib/blog-routing";

const formatBlogCopy = await getTranslator({ locale: DEFAULT_LOCALE, namespace: "Blog" });

test("renders seeded blog content from fresh D1 state", async () => {
  await loadAppFrame("/blog");

  await expectAppRole("heading", formatBlogCopy("ListPage.title"), { exact: true });
  await expectAppText(SEEDED_BLOG_ENTRY.title, { exact: true });
});

test("renders a full seeded blog article with author, tags, and rich content", async () => {
  await loadAppFrame(SEEDED_BLOG_ENTRY_PATH);

  await expectAppRole("heading", SEEDED_BLOG_ENTRY.title, { exact: true });
  await expectAppText(SEEDED_BLOG_ENTRY.authorName, { exact: true });

  for (const text of [...SEEDED_BLOG_ENTRY.tagNames, ...SEEDED_BLOG_ENTRY.contentHeadings]) {
    await expectAppText(text, { exact: true });
  }
});

test("serves a blog article as markdown at its .md URL", async () => {
  const response = await fetchAppPath(`${SEEDED_BLOG_ENTRY_PATH}.md`);

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^text\/markdown\b/);
  await expect(response.text()).resolves.toContain(SEEDED_BLOG_ENTRY.contentHeadings[0]);
});

test("routes numbered blog pages to the correct paginated result set", async () => {
  await loadAppFrame("/blog/2");

  await expectAppPathname("/blog/2");
  await expectAppRole("heading", formatBlogCopy("ListPage.title"), { exact: true });
  await expectAppText(SEEDED_BLOG_PAGE_TWO_TITLE, { exact: true });
  await expectNoAppText(SEEDED_BLOG_ENTRY.title, { exact: true });
});

test("filters blog posts by seeded tag", async () => {
  await loadAppFrame(getBlogTagPagePath(SEEDED_BLOG_TAG.slug));

  await expectAppRole("heading", SEEDED_BLOG_TAG.name, { exact: true });
  await expectAppText(formatBlogCopy("Common.postCount", { count: SEEDED_BLOG_TAG.postCount }), {
    exact: true,
  });

  for (const title of SEEDED_BLOG_TAG.postTitles) {
    await expectAppText(title, { exact: true });
  }
});

test("filters blog posts by seeded author", async () => {
  await loadAppFrame(getBlogAuthorPagePath(SEEDED_BLOG_AUTHOR));

  await expectAppRole("heading", SEEDED_BLOG_ENTRY.authorName, { exact: true });
  await expectAppText(
    formatBlogCopy("Common.postCount", { count: SEEDED_BLOG_AUTHOR.publishedPostCount }),
    { exact: true }
  );
  await expectAppText(SEEDED_BLOG_ENTRY.title, { exact: true });
  await expectAppText(SEEDED_BLOG_AUTHOR.otherPostTitle, { exact: true });
});
