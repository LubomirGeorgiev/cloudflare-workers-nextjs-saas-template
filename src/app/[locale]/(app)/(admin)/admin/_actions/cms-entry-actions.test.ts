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

const { deleteCmsEntryAction } = await import("./cms-entry-actions");

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
});
