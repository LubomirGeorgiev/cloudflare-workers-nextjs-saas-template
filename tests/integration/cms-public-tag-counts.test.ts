/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { cmsEntryTable, cmsEntryTagTable, cmsTagTable, userTable } from "@/db/schema";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import { BLOG_COLLECTION_SLUG } from "@/lib/blog-routing";
import { getCmsTags } from "@/lib/cms/tags";

// `getCmsTags` runs inside `"use cache: remote"`; this environment has no Next cache runtime.
vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  revalidateTag: vi.fn(),
}));

const db = getDB();
const TAG_SLUG = "public-count-tag";
const NON_DEFAULT_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE);

describe("getCmsTags entry counts", () => {
  beforeEach(async () => {
    await env.D1_DB.batch([
      env.D1_DB.prepare("DELETE FROM cms_entry_tag"),
      env.D1_DB.prepare("DELETE FROM cms_entry"),
      env.D1_DB.prepare("DELETE FROM cms_tag"),
      env.D1_DB.prepare("DELETE FROM user"),
    ]);
  });

  it("counts only published blog posts in the locale for the public view, and every entry otherwise", async () => {
    const [user] = await db
      .insert(userTable)
      .values({ id: "usr_public_tag_count", email: "public-tag-count@example.com" })
      .returning({ id: userTable.id });
    const [tag] = await db
      .insert(cmsTagTable)
      .values({ createdBy: user.id, name: "Public Count Tag", slug: TAG_SLUG })
      .returning({ id: cmsTagTable.id });

    const seeds = [
      { slug: "published-post", status: CMS_ENTRY_STATUS.PUBLISHED, locale: DEFAULT_LOCALE },
      { slug: "archived-post", status: CMS_ENTRY_STATUS.ARCHIVED, locale: DEFAULT_LOCALE },
      { slug: "draft-post", status: CMS_ENTRY_STATUS.DRAFT, locale: DEFAULT_LOCALE },
      ...(NON_DEFAULT_LOCALE
        ? [{ slug: "published-post", status: CMS_ENTRY_STATUS.PUBLISHED, locale: NON_DEFAULT_LOCALE }]
        : []),
    ];
    const entries = await db
      .insert(cmsEntryTable)
      .values(seeds.map((seed) => ({
        ...seed,
        collection: BLOG_COLLECTION_SLUG,
        title: seed.slug,
        content: {},
        createdBy: user.id,
      })))
      .returning({ id: cmsEntryTable.id });
    await db
      .insert(cmsEntryTagTable)
      .values(entries.map((entry) => ({ entryId: entry.id, tagId: tag.id })));

    const findCount = (tags: Awaited<ReturnType<typeof getCmsTags>>) =>
      tags.find((candidate) => candidate.slug === TAG_SLUG)?.entryCount;

    expect(findCount(await getCmsTags())).toBe(seeds.length);
    expect(findCount(await getCmsTags({ locale: DEFAULT_LOCALE, countPublishedPosts: true }))).toBe(1);
    if (NON_DEFAULT_LOCALE) {
      expect(findCount(await getCmsTags({ locale: NON_DEFAULT_LOCALE, countPublishedPosts: true }))).toBe(1);
    }
  });
});
