/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { getDB } from "@/db";
import { cmsEntryTable, userTable } from "@/db/schema";

const db = getDB();

async function clearCmsLocaleRows(): Promise<void> {
  await env.NEXT_TAG_CACHE_D1.batch([
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM cms_entry"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM user"),
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

// After adding the locale column, an existing-style insert (no locale) must default to
// 'en' and remain uniquely addressable by (collection, slug) within that locale.
describe("cms_entry locale column", () => {
  beforeEach(async () => {
    await clearCmsLocaleRows();
  });

  it("defaults locale to 'en' and preserves single-row slug lookup", async () => {
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
    expect(rows.every((r) => r.locale === "en")).toBe(true);
  });
});
