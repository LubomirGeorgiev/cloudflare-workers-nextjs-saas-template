import { afterEach, describe, expect, test, vi } from "vitest";

import { cmsConfig } from "@/../cms.config";
import { DEFAULT_LOCALE, ENABLED_LOCALES } from "@/i18n/config";

const {
  createCmsEntryMock,
  createCmsEntryTranslationMock,
  deleteCmsEntryMock,
  generateSeoDescriptionMock,
  getCmsCollectionCountMock,
  getCmsCollectionMock,
  getCmsEntryByIdMock,
  getEntryLocalesForSlugsMock,
  markCmsEntryTranslationReviewedMock,
  requireAdminMock,
  retranslateCmsEntryMock,
  revalidatePathMock,
  updateCmsEntryMock,
} = vi.hoisted(() => ({
  createCmsEntryMock: vi.fn(),
  createCmsEntryTranslationMock: vi.fn(),
  deleteCmsEntryMock: vi.fn(),
  generateSeoDescriptionMock: vi.fn(),
  getCmsCollectionCountMock: vi.fn(),
  getCmsCollectionMock: vi.fn(),
  getCmsEntryByIdMock: vi.fn(),
  getEntryLocalesForSlugsMock: vi.fn(),
  markCmsEntryTranslationReviewedMock: vi.fn(),
  requireAdminMock: vi.fn(),
  retranslateCmsEntryMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  updateCmsEntryMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

// The KV sweep needs a Worker binding and is asserted in `cms-entry-revalidation.test.ts`.
vi.mock("@/lib/markdown-pages/purge-page-cache", () => ({
  purgeMarkdownPageCache: vi.fn(),
}));

vi.mock("@/utils/auth", () => ({
  requireAdmin: requireAdminMock,
}));

const actionClientMock = {
  action: (handler: (args: { parsedInput: unknown }) => unknown) => {
    return (input?: unknown) => handler({ parsedInput: input });
  },
  inputSchema() {
    return actionClientMock;
  },
  metadata() {
    return actionClientMock;
  },
};

vi.mock("@/lib/safe-action", () => ({
  actionClient: actionClientMock,
}));

vi.mock("@/lib/cms/entry", () => ({
  createCmsEntry: createCmsEntryMock,
  createCmsEntryTranslation: createCmsEntryTranslationMock,
  deleteCmsEntry: deleteCmsEntryMock,
  getCmsCollection: getCmsCollectionMock,
  getCmsCollectionCount: getCmsCollectionCountMock,
  getCmsEntryById: getCmsEntryByIdMock,
  getEntryLocalesForSlugs: getEntryLocalesForSlugsMock,
  markCmsEntryTranslationReviewed: markCmsEntryTranslationReviewedMock,
  retranslateCmsEntry: retranslateCmsEntryMock,
  updateCmsEntry: updateCmsEntryMock,
}));

vi.mock("@/lib/cms/generate-seo-description", () => ({
  generateSeoDescription: generateSeoDescriptionMock,
}));

const {
  createTranslationAction,
  deleteCmsEntryAction,
  retranslateTranslationAction,
  updateCmsEntryAction,
} = await import("./cms-entry-actions");
const { reportCmsCachePurge } = await import("@/lib/cms/cms-cache-purge-report");
const { CMS_CACHE_PURGE_OK, CMS_PURGE_STATUS } = await import("@/constants/cache-purge");

const ZONE_PURGE_FAILED = { ...CMS_CACHE_PURGE_OK, zone: CMS_PURGE_STATUS.FAILED };

const UPDATED_ENTRY = { id: "entry_launch_notes", collection: "blog", slug: "launch-notes" };

describe("CMS entry actions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("deleteCmsEntryAction revalidates admin and public paths for the deleted entry", async () => {
    requireAdminMock.mockResolvedValue({ userId: "usr_admin" });
    deleteCmsEntryMock.mockResolvedValue({
      id: "entry_launch_notes",
      collection: "blog",
      slug: "launch-notes",
    });

    await deleteCmsEntryAction({ id: "entry_launch_notes" });

    expect(deleteCmsEntryMock).toHaveBeenCalledWith({ id: "entry_launch_notes" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/cms");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/cms/blog");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/cms/blog/entry_launch_notes");

    const previewUrl = cmsConfig.collections.blog.previewUrl("launch-notes");
    for (const locale of ENABLED_LOCALES) {
      const path = locale === DEFAULT_LOCALE ? previewUrl : `/${locale}${previewUrl}`;
      expect(revalidatePathMock).toHaveBeenCalledWith(path);
    }
  });

  // The write is saved either way; the editor shows a warning toast from this field.
  test("updateCmsEntryAction reports a failed zone purge from inside the write", async () => {
    requireAdminMock.mockResolvedValue({ userId: "usr_admin" });
    getCmsEntryByIdMock.mockResolvedValue(UPDATED_ENTRY);
    updateCmsEntryMock.mockImplementation(async () => {
      reportCmsCachePurge(ZONE_PURGE_FAILED);
      return UPDATED_ENTRY;
    });

    const result = await updateCmsEntryAction({ id: UPDATED_ENTRY.id, title: "Launch notes" });

    expect(result).toEqual({ ...UPDATED_ENTRY, cachePurge: ZONE_PURGE_FAILED });
  });

  test("updateCmsEntryAction reports no failure when the zone purge went through", async () => {
    requireAdminMock.mockResolvedValue({ userId: "usr_admin" });
    getCmsEntryByIdMock.mockResolvedValue(UPDATED_ENTRY);
    updateCmsEntryMock.mockImplementation(async () => {
      reportCmsCachePurge(CMS_CACHE_PURGE_OK);
      return UPDATED_ENTRY;
    });

    const result = await updateCmsEntryAction({ id: UPDATED_ENTRY.id, title: "Launch notes" });

    expect(result).toEqual({ ...UPDATED_ENTRY, cachePurge: CMS_CACHE_PURGE_OK });
  });

  test("createTranslationAction reports a failed zone purge from inside the write", async () => {
    requireAdminMock.mockResolvedValue({ userId: "usr_admin" });
    createCmsEntryTranslationMock.mockImplementation(async () => {
      reportCmsCachePurge(ZONE_PURGE_FAILED);
      return { ...UPDATED_ENTRY, aiTranslated: false };
    });

    const result = await createTranslationAction({
      collection: "blog",
      slug: UPDATED_ENTRY.slug,
      sourceLocale: DEFAULT_LOCALE,
      targetLocale: DEFAULT_LOCALE,
      autoTranslate: false,
    });

    expect(result).toEqual({ ...UPDATED_ENTRY, aiTranslated: false, cachePurge: ZONE_PURGE_FAILED });
  });

  // The banner reloads the page after this action, so the field rides the reload stash.
  test("retranslateTranslationAction reports a failed zone purge from inside the write", async () => {
    requireAdminMock.mockResolvedValue({ userId: "usr_admin" });
    retranslateCmsEntryMock.mockImplementation(async () => {
      reportCmsCachePurge(ZONE_PURGE_FAILED);
      return UPDATED_ENTRY;
    });

    const result = await retranslateTranslationAction({ id: UPDATED_ENTRY.id });

    expect(result).toEqual({ ...UPDATED_ENTRY, cachePurge: ZONE_PURGE_FAILED });
  });

  // No drift only re-anchors the hashes: no page changes, so no zone purge runs.
  test("retranslateTranslationAction reports no failure when no zone purge ran", async () => {
    requireAdminMock.mockResolvedValue({ userId: "usr_admin" });
    retranslateCmsEntryMock.mockResolvedValue(UPDATED_ENTRY);

    const result = await retranslateTranslationAction({ id: UPDATED_ENTRY.id });

    expect(result).toEqual({ ...UPDATED_ENTRY, cachePurge: CMS_CACHE_PURGE_OK });
  });
});
