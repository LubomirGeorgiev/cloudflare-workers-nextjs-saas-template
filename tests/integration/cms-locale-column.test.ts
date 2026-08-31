/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { getDB } from "@/db";
import { cmsEntryTable, userTable } from "@/db/schema";
import { DEFAULT_LOCALE } from "@/i18n/config";

const db = getDB();

async function clearCmsLocaleRows(): Promise<void> {
  await env.D1_DB.batch([
    env.D1_DB.prepare("DELETE FROM cms_entry"),
    env.D1_DB.prepare("DELETE FROM user"),
  ]);
}

async function seedUser(): Promise<string> {
  const [user] = await db
    .insert(userTable)
    .values({
      id: "usr_test",
      email: "cms-locale-author@example.com",
    })
    .returning({ id: userTable.id });

  return user.id;
}

// An existing-style insert (no locale) must use the configured default and remain
// uniquely addressable by (collection, slug) within that locale.
describe("cms_entry locale column", () => {
  beforeEach(async () => {
    await clearCmsLocaleRows();
  });

  it("uses DEFAULT_LOCALE and preserves single-row slug lookup", async () => {
    const createdBy = await seedUser();

    await db.insert(cmsEntryTable).values({
      collection: "blog",
      title: "Hello",
      content: {},
      slug: `hello-${Math.random().toString(36).slice(2)}`,
      status: "published",
      createdBy,
    } as never);

    const rows = await db.query.cmsEntryTable.findMany({ where: { collection: "blog" } });
    expect(rows.every((row) => row.locale === DEFAULT_LOCALE)).toBe(true);
  });
});
