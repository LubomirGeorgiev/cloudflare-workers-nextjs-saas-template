import { afterEach, describe, expect, test, vi } from "vitest";

import { cmsConfig } from "@/../cms.config";
import { DEFAULT_LOCALE, ENABLED_LOCALES } from "@/i18n/config";
import { cmsEntryListingPath } from "@/lib/cms/cms-entry-page-purge";

const {
  deleteCmsEntryVersionMock,
  getCmsEntryByIdMock,
  getCmsEntryVersionCountMock,
  getCmsEntryVersionsMock,
  purgeMarkdownPageCacheMock,
  requireAdminMock,
  revalidatePathMock,
  revertCmsEntryToVersionMock,
} = vi.hoisted(() => ({
  deleteCmsEntryVersionMock: vi.fn(),
  getCmsEntryByIdMock: vi.fn(),
  getCmsEntryVersionCountMock: vi.fn(),
  getCmsEntryVersionsMock: vi.fn(),
  purgeMarkdownPageCacheMock: vi.fn(async () => undefined),
  requireAdminMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  revertCmsEntryToVersionMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

// The KV sweep needs a Worker binding, so the mock stands in for it and the assertions below
// check only the pathnames the revert hands it.
vi.mock("@/lib/markdown-pages/purge-page-cache", () => ({
  purgeMarkdownPageCache: purgeMarkdownPageCacheMock,
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
  deleteCmsEntryVersion: deleteCmsEntryVersionMock,
  getCmsEntryById: getCmsEntryByIdMock,
  getCmsEntryVersionCount: getCmsEntryVersionCountMock,
  getCmsEntryVersions: getCmsEntryVersionsMock,
  revertCmsEntryToVersion: revertCmsEntryToVersionMock,
}));

const { revertCmsEntryVersionAction } = await import("./version-actions");

describe("CMS entry version actions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("revertCmsEntryVersionAction revalidates admin and public paths for old and restored slugs", async () => {
    requireAdminMock.mockResolvedValue({ userId: "usr_admin" });
    getCmsEntryByIdMock.mockResolvedValue({
      id: "entry_launch_notes",
      collection: "blog",
      slug: "current-launch-notes",
    });
    revertCmsEntryToVersionMock.mockResolvedValue({
      id: "entry_launch_notes",
      collection: "blog",
      slug: "restored-launch-notes",
    });

    await revertCmsEntryVersionAction({
      entryId: "entry_launch_notes",
      versionId: "version_1",
    });

    expect(getCmsEntryByIdMock).toHaveBeenCalledWith({ id: "entry_launch_notes" });
    expect(revertCmsEntryToVersionMock).toHaveBeenCalledWith({
      entryId: "entry_launch_notes",
      versionId: "version_1",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/cms");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/cms/blog");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/cms/blog/entry_launch_notes");

    for (const slug of ["current-launch-notes", "restored-launch-notes"]) {
      const previewUrl = cmsConfig.collections.blog.previewUrl(slug);
      for (const locale of ENABLED_LOCALES) {
        const path = locale === DEFAULT_LOCALE ? previewUrl : `/${locale}${previewUrl}`;
        expect(revalidatePathMock).toHaveBeenCalledWith(path);
      }
    }
  });

  // `revalidatePath` misses the converted `.md` twins, so the revert owes them the same purge the
  // update action makes; both slugs share one listing path.
  test("revertCmsEntryVersionAction purges the Markdown pages of the reverted entry", async () => {
    requireAdminMock.mockResolvedValue({ userId: "usr_admin" });
    getCmsEntryByIdMock.mockResolvedValue({
      id: "entry_launch_notes",
      collection: "blog",
      slug: "current-launch-notes",
    });
    revertCmsEntryToVersionMock.mockResolvedValue({
      id: "entry_launch_notes",
      collection: "blog",
      slug: "restored-launch-notes",
    });

    await revertCmsEntryVersionAction({
      entryId: "entry_launch_notes",
      versionId: "version_1",
    });

    const listingPath = cmsEntryListingPath(
      cmsConfig.collections.blog.previewUrl("restored-launch-notes"),
    );

    expect(purgeMarkdownPageCacheMock).toHaveBeenCalledWith({ pathnames: [listingPath] });
  });
});
