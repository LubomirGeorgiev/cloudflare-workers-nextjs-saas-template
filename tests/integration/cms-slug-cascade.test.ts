/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { cmsEntryTable, userTable } from "@/db/schema";
import { updateCmsEntry } from "@/lib/cms/entry/mutations";

// `updateCmsEntry` invalidates CMS caches via `revalidateCacheTag`, which
// (like `cacheTag`/`cacheLife`) requires Next's `cacheComponents` runtime. Stub it so
// the underlying D1 mutation (the thing this test actually verifies) still runs.
vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

const db = getDB();

// Same (collection, slug) translation group pattern used across the Phase 3 locale tests:
// rows differ only by locale.
const COLLECTION_SLUG = "blog";
const SHARED_SLUG = "slug-cascade-test-post";
const OTHER_GROUP_SLUG = "slug-cascade-other-group";

async function clearCmsLocaleRows(): Promise<void> {
  await env.NEXT_TAG_CACHE_D1.batch([
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM cms_entry_version"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM cms_entry_tag"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM cms_entry"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM user"),
  ]);
}

async function seedUser(id: string): Promise<string> {
  const [user] = await db
    .insert(userTable)
    .values({
      id,
      email: `${id}@example.com`,
    })
    .returning({ id: userTable.id });

  return user.id;
}

describe("updateCmsEntry slug cascade", () => {
  beforeEach(async () => {
    await clearCmsLocaleRows();
  });

  it("cascades a slug rename to every locale sibling in the translation group", async () => {
    const authorId = await seedUser("usr_slug_cascade_author");

    const [enEntry] = await db
      .insert(cmsEntryTable)
      .values({
        collection: COLLECTION_SLUG,
        title: "Hello",
        content: { type: "doc", content: [{ type: "paragraph" }] },
        slug: SHARED_SLUG,
        locale: "en",
        status: CMS_ENTRY_STATUS.PUBLISHED,
        seoDescription: "An English greeting post.",
        createdBy: authorId,
        // oxlint-disable-next-line typescript/no-explicit-any
      } as any)
      .returning();

    const [esEntry] = await db
      .insert(cmsEntryTable)
      .values({
        collection: COLLECTION_SLUG,
        title: "Hola",
        content: { type: "doc", content: [{ type: "paragraph" }] },
        slug: SHARED_SLUG,
        locale: "es",
        status: CMS_ENTRY_STATUS.PUBLISHED,
        seoDescription: "Un saludo en espanol.",
        createdBy: authorId,
        // oxlint-disable-next-line typescript/no-explicit-any
      } as any)
      .returning();

    const updated = await updateCmsEntry({
      id: enEntry.id,
      slug: "renamed-post",
    });

    expect(updated?.slug).toBe("renamed-post");

    const reloadedEn = await db.query.cmsEntryTable.findFirst({
      where: { id: enEntry.id },
    });
    const reloadedEs = await db.query.cmsEntryTable.findFirst({
      where: { id: esEntry.id },
    });

    // The group must stay linked: both sibling rows now share the new slug.
    expect(reloadedEn?.slug).toBe("renamed-post");
    expect(reloadedEs?.slug).toBe("renamed-post");

    // Non-slug fields must remain unaffected on the sibling that was not directly edited.
    expect(reloadedEs?.title).toBe("Hola");
    expect(reloadedEs?.status).toBe(CMS_ENTRY_STATUS.PUBLISHED);
  });

  it("throws when renaming to a slug already used by a different translation group in the same collection", async () => {
    const authorId = await seedUser("usr_slug_cascade_conflict_author");

    const [enEntry] = await db
      .insert(cmsEntryTable)
      .values({
        collection: COLLECTION_SLUG,
        title: "Hello",
        content: { type: "doc", content: [{ type: "paragraph" }] },
        slug: SHARED_SLUG,
        locale: "en",
        status: CMS_ENTRY_STATUS.PUBLISHED,
        createdBy: authorId,
        // oxlint-disable-next-line typescript/no-explicit-any
      } as any)
      .returning();

    await db.insert(cmsEntryTable).values({
      collection: COLLECTION_SLUG,
      title: "Other group",
      content: { type: "doc", content: [{ type: "paragraph" }] },
      slug: OTHER_GROUP_SLUG,
      locale: "en",
      status: CMS_ENTRY_STATUS.PUBLISHED,
      createdBy: authorId,
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    await expect(
      updateCmsEntry({
        id: enEntry.id,
        slug: OTHER_GROUP_SLUG,
      })
    ).rejects.toThrow();

    // Rejected rename must not have mutated the entry.
    const reloadedEn = await db.query.cmsEntryTable.findFirst({
      where: { id: enEntry.id },
    });
    expect(reloadedEn?.slug).toBe(SHARED_SLUG);
  });

  it("allows renaming a single-row entry (no siblings) without a group conflict false-positive", async () => {
    const authorId = await seedUser("usr_slug_cascade_solo_author");

    const [entry] = await db
      .insert(cmsEntryTable)
      .values({
        collection: COLLECTION_SLUG,
        title: "Solo",
        content: { type: "doc", content: [{ type: "paragraph" }] },
        slug: "solo-slug-original",
        locale: "en",
        status: CMS_ENTRY_STATUS.PUBLISHED,
        createdBy: authorId,
        // oxlint-disable-next-line typescript/no-explicit-any
      } as any)
      .returning();

    const updated = await updateCmsEntry({
      id: entry.id,
      slug: "solo-slug-renamed",
    });

    expect(updated?.slug).toBe("solo-slug-renamed");
  });
});
