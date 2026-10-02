/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { cmsEntryTable, cmsNavigationItemTable, userTable } from "@/db/schema";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";
import { getCmsNavigationEntryPaths } from "@/lib/cms/cms-navigation-entry-paths";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation";
import { chunk } from "@/utils/chunk";

const db = getDB();
const NAVIGATION_KEY = getCmsCollectionNavigationKey(DOCS_SLUG);
const TRANSLATION_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE);
// More than one lookup chunk (90 slugs), so the second chunk must resolve too.
const ENTRY_COUNT = 95;
// Small enough to stay under the D1 limit of 100 bound parameters per insert statement.
const INSERT_BATCH_SIZE = 5;
const AUTHOR_EMAIL = "nav-entry-paths-author@example.com";

function slugAt(index: number): string {
  return `nav-path-entry-${index}`;
}

function pathOf(slug: string): string {
  return `/docs/${slug}`;
}

async function clearRows(): Promise<void> {
  await env.D1_DB.batch([
    env.D1_DB.prepare("DELETE FROM cms_navigation_item"),
    env.D1_DB.prepare("DELETE FROM cms_entry_version"),
    env.D1_DB.prepare("DELETE FROM cms_entry_tag"),
    env.D1_DB.prepare("DELETE FROM cms_entry"),
    env.D1_DB.prepare("DELETE FROM user"),
  ]);
}

async function seedDocsEntries(navigationKey: NonNullable<typeof NAVIGATION_KEY>): Promise<string> {
  const [author] = await db.insert(userTable).values({ email: AUTHOR_EMAIL }).returning({ id: userTable.id });

  const indexes = Array.from({ length: ENTRY_COUNT }, (_, index) => index);

  for (const indexChunk of chunk({ items: indexes, size: INSERT_BATCH_SIZE })) {
    const entries = await db
      .insert(cmsEntryTable)
      .values(indexChunk.map((index) => ({
        collection: DOCS_SLUG,
        title: `Entry ${index}`,
        content: { type: "doc", content: [{ type: "paragraph" }] },
        slug: slugAt(index),
        locale: DEFAULT_LOCALE,
        status: CMS_ENTRY_STATUS.PUBLISHED,
        createdBy: author.id,
      })))
      .returning({ id: cmsEntryTable.id, slug: cmsEntryTable.slug });

    await db.insert(cmsNavigationItemTable).values(entries.map((entry) => ({
      navigationKey,
      nodeType: CMS_NAVIGATION_NODE_TYPES.PAGE,
      title: entry.slug,
      entryId: entry.id,
      slugSegment: entry.slug,
      resolvedPath: pathOf(entry.slug),
      sortOrder: indexes.findIndex((index) => slugAt(index) === entry.slug),
    })));
  }

  return author.id;
}

describe.skipIf(!NAVIGATION_KEY)("getCmsNavigationEntryPaths against D1", () => {
  let authorId: string;

  beforeEach(async () => {
    await clearRows();
    authorId = await seedDocsEntries(NAVIGATION_KEY ?? DOCS_SLUG);
  });

  it("resolves every path when the slugs span more than one lookup chunk", async () => {
    const paths = await getCmsNavigationEntryPaths({
      entries: Array.from({ length: ENTRY_COUNT }, (_, index) => ({
        collection: DOCS_SLUG,
        slug: slugAt(index),
      })),
    });

    expect(new Set(paths)).toEqual(
      new Set(Array.from({ length: ENTRY_COUNT }, (_, index) => pathOf(slugAt(index)))),
    );
  });

  // Navigation links the default-locale row, so a translation edit must still name the page.
  it.skipIf(!TRANSLATION_LOCALE)("resolves the path of an entry that also has a translation", async () => {
    const index = ENTRY_COUNT - 1;
    await db.insert(cmsEntryTable).values({
      collection: DOCS_SLUG,
      title: `Translated ${index}`,
      content: { type: "doc", content: [{ type: "paragraph" }] },
      slug: slugAt(index),
      locale: TRANSLATION_LOCALE ?? DEFAULT_LOCALE,
      status: CMS_ENTRY_STATUS.PUBLISHED,
      createdBy: authorId,
    });

    const paths = await getCmsNavigationEntryPaths({
      entries: [{ collection: DOCS_SLUG, slug: slugAt(index) }],
    });

    expect(paths).toEqual([pathOf(slugAt(index))]);
  });
});
