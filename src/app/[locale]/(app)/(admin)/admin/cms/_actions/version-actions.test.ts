import { afterEach, describe, expect, test, vi } from "vitest";

import { cmsConfig } from "@/../cms.config";
import { DEFAULT_LOCALE, ENABLED_LOCALES } from "@/i18n/config";

const {
  deleteCmsEntryVersionMock,
  getCmsEntryByIdMock,
  getCmsEntryVersionCountMock,
  getCmsEntryVersionsMock,
  requireAdminMock,
  revalidatePathMock,
  revertCmsEntryToVersionMock,
} = vi.hoisted(() => ({
  deleteCmsEntryVersionMock: vi.fn(),
  getCmsEntryByIdMock: vi.fn(),
  getCmsEntryVersionCountMock: vi.fn(),
  getCmsEntryVersionsMock: vi.fn(),
  requireAdminMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  revertCmsEntryToVersionMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
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
  deleteCmsEntryVersion: deleteCmsEntryVersionMock,
  getCmsEntryById: getCmsEntryByIdMock,
  getCmsEntryVersionCount: getCmsEntryVersionCountMock,
  getCmsEntryVersions: getCmsEntryVersionsMock,
  revertCmsEntryToVersion: revertCmsEntryToVersionMock,
}));

const { revertCmsEntryVersionAction } = await import("./version-actions");
const { reportCmsCachePurge } = await import("@/lib/cms/cms-cache-purge-report");
const { CMS_CACHE_PURGE_OK, CMS_PURGE_STATUS } = await import("@/constants/cache-purge");

const ZONE_PURGE_FAILED = { ...CMS_CACHE_PURGE_OK, zone: CMS_PURGE_STATUS.FAILED };

const REVERTED_ENTRY = { id: "entry_launch_notes", collection: "blog", slug: "launch-notes" };

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

  // The editor reloads after a revert, so the field rides the reload stash to the next page.
  test("revertCmsEntryVersionAction reports a failed zone purge from inside the write", async () => {
    requireAdminMock.mockResolvedValue({ userId: "usr_admin" });
    getCmsEntryByIdMock.mockResolvedValue(REVERTED_ENTRY);
    revertCmsEntryToVersionMock.mockImplementation(async () => {
      reportCmsCachePurge(ZONE_PURGE_FAILED);
      return { ...REVERTED_ENTRY, scheduleCleared: false };
    });

    const result = await revertCmsEntryVersionAction({
      entryId: REVERTED_ENTRY.id,
      versionId: "version_1",
    });

    expect(result).toEqual({ ...REVERTED_ENTRY, scheduleCleared: false, cachePurge: ZONE_PURGE_FAILED });
  });

  test("revertCmsEntryVersionAction reports no failure when the zone purge went through", async () => {
    requireAdminMock.mockResolvedValue({ userId: "usr_admin" });
    getCmsEntryByIdMock.mockResolvedValue(REVERTED_ENTRY);
    revertCmsEntryToVersionMock.mockImplementation(async () => {
      reportCmsCachePurge(CMS_CACHE_PURGE_OK);
      return { ...REVERTED_ENTRY, scheduleCleared: false };
    });

    const result = await revertCmsEntryVersionAction({
      entryId: REVERTED_ENTRY.id,
      versionId: "version_1",
    });

    expect(result).toEqual({ ...REVERTED_ENTRY, scheduleCleared: false, cachePurge: CMS_CACHE_PURGE_OK });
  });
});
