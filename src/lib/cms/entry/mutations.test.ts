import { describe, expect, test, vi } from "vitest";

import { collectionSlugs } from "@/../cms.config";
import { CMS_ENTRY_STATUS } from "@/app/enums";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import { ActionError } from "@/lib/action-error";

const { getDBMock, translateEntryFieldsMock } = vi.hoisted(() => ({
  getDBMock: vi.fn(),
  translateEntryFieldsMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

vi.mock("@/lib/cms/translate-entry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cms/translate-entry")>()),
  translateEntryFields: translateEntryFieldsMock,
}));

const { retranslateCmsEntry } = await import("@/lib/cms/entry/mutations");
const { computeEntryTranslatableHashes } = await import("@/lib/cms/translation-staleness");

/** Any configured collection and any non-default locale, so a fork's catalog still runs this. */
const COLLECTION = collectionSlugs[0];
const TARGET_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE);

const SOURCE_ENTRY = {
  id: "entry-source",
  collection: COLLECTION,
  slug: "hello-world",
  locale: DEFAULT_LOCALE,
  title: "New source title",
  content: { type: "doc", content: [] },
  seoDescription: null,
  status: CMS_ENTRY_STATUS.PUBLISHED,
};

const TRANSLATION_ENTRY = {
  ...SOURCE_ENTRY,
  id: "entry-translation",
  locale: TARGET_LOCALE,
  title: "Translated old title",
  // Snapshot of an older source title, so the title reads as stale.
  sourceContentHashes: computeEntryTranslatableHashes({ ...SOURCE_ENTRY, title: "Old source title" }),
};

function mockDatabase() {
  const findFirstMock = vi
    .fn()
    .mockResolvedValueOnce(TRANSLATION_ENTRY)
    .mockResolvedValueOnce(SOURCE_ENTRY);
  const updateMock = vi.fn();

  getDBMock.mockReturnValue({
    query: { cmsEntryTable: { findFirst: findFirstMock } },
    update: updateMock,
  });

  return { updateMock };
}

describe.skipIf(!TARGET_LOCALE)("retranslateCmsEntry", () => {
  // A verbatim fallback holds source text. Saving it with fresh hashes would hide the stale banner
  // over a translation that is now in the source language.
  test("refuses and writes nothing when the AI translation did not happen", async () => {
    const { updateMock } = mockDatabase();
    translateEntryFieldsMock.mockResolvedValue({
      title: SOURCE_ENTRY.title,
      seoDescription: SOURCE_ENTRY.seoDescription,
      content: SOURCE_ENTRY.content,
      translated: false,
    });

    const result = retranslateCmsEntry({ id: TRANSLATION_ENTRY.id });

    await expect(result).rejects.toBeInstanceOf(ActionError);
    await expect(result).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(translateEntryFieldsMock).toHaveBeenCalledWith(
      expect.objectContaining({ only: ["title"], targetLocale: TARGET_LOCALE }),
    );
    expect(updateMock).not.toHaveBeenCalled();
  });
});
