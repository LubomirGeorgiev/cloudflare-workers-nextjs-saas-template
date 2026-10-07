import { afterEach, describe, expect, test, vi } from "vitest";

import { DEFAULT_LOCALE, ENABLED_LOCALES } from "@/i18n/config";
import { CMS_TAGS_PAGE_PATH } from "@/lib/blog-routing";

const {
  createCmsTagMock,
  createCmsTagTranslationMock,
  deleteCmsTagMock,
  getCmsTagsMock,
  requireAdminMock,
  revalidatePathMock,
  updateCmsTagMock,
} = vi.hoisted(() => ({
  createCmsTagMock: vi.fn(),
  createCmsTagTranslationMock: vi.fn(),
  deleteCmsTagMock: vi.fn(),
  getCmsTagsMock: vi.fn(),
  requireAdminMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  updateCmsTagMock: vi.fn(),
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

vi.mock("@/lib/cms/tags", () => ({
  createCmsTag: createCmsTagMock,
  createCmsTagTranslation: createCmsTagTranslationMock,
  deleteCmsTag: deleteCmsTagMock,
  getCmsTags: getCmsTagsMock,
  updateCmsTag: updateCmsTagMock,
}));

const {
  createCmsTagAction,
  createTagTranslationAction,
  deleteCmsTagAction,
  updateCmsTagAction,
} = await import("./cms-tag-actions");
const { reportCmsCachePurge } = await import("@/lib/cms/cms-cache-purge-report");
const { CMS_CACHE_PURGE_OK, CMS_PURGE_STATUS } = await import("@/constants/cache-purge");

const ZONE_PURGE_FAILED = { ...CMS_CACHE_PURGE_OK, zone: CMS_PURGE_STATUS.FAILED };

const TAG = { id: "tag_release_notes", slug: "release-notes", name: "Release notes" };

// Each tag write runs the zone purge inside its library mutation, so the mock reports from there.
const TAG_WRITES = [
  {
    name: "createCmsTagAction",
    mutationMock: createCmsTagMock,
    run: () => createCmsTagAction({ name: TAG.name, slug: TAG.slug }),
  },
  {
    name: "updateCmsTagAction",
    mutationMock: updateCmsTagMock,
    run: () => updateCmsTagAction({ id: TAG.id, name: TAG.name }),
  },
  {
    name: "deleteCmsTagAction",
    mutationMock: deleteCmsTagMock,
    run: () => deleteCmsTagAction({ id: TAG.id }),
  },
  {
    name: "createTagTranslationAction",
    mutationMock: createCmsTagTranslationMock,
    run: () => createTagTranslationAction({
      slug: TAG.slug,
      sourceLocale: DEFAULT_LOCALE,
      targetLocale: DEFAULT_LOCALE,
      autoTranslate: false,
    }),
  },
];

describe("CMS tag actions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("deleteCmsTagAction revalidates the deleted tag detail path for every served locale", async () => {
    requireAdminMock.mockResolvedValue({ userId: "usr_admin" });
    deleteCmsTagMock.mockResolvedValue({ slug: "release-notes" });

    await deleteCmsTagAction({ id: "tag_release_notes" });

    expect(deleteCmsTagMock).toHaveBeenCalledWith("tag_release_notes");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/cms/tags");

    for (const locale of ENABLED_LOCALES) {
      const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
      expect(revalidatePathMock).toHaveBeenCalledWith(`${prefix}${CMS_TAGS_PAGE_PATH}`);
      expect(revalidatePathMock).toHaveBeenCalledWith(`${prefix}${CMS_TAGS_PAGE_PATH}/release-notes`);
    }
  });

  // The write is saved either way; the tag pages show a warning toast from this field.
  test.each(TAG_WRITES)("$name reports a failed zone purge from inside the write", async ({
    mutationMock,
    run,
  }) => {
    requireAdminMock.mockResolvedValue({ userId: "usr_admin" });
    mutationMock.mockImplementation(async () => {
      reportCmsCachePurge(ZONE_PURGE_FAILED);
      return TAG;
    });

    expect(await run()).toEqual(expect.objectContaining({ cachePurge: ZONE_PURGE_FAILED }));
  });

  test.each(TAG_WRITES)("$name reports no failure when the zone purge went through", async ({
    mutationMock,
    run,
  }) => {
    requireAdminMock.mockResolvedValue({ userId: "usr_admin" });
    mutationMock.mockImplementation(async () => {
      reportCmsCachePurge(CMS_CACHE_PURGE_OK);
      return TAG;
    });

    expect(await run()).toEqual(expect.objectContaining({ cachePurge: CMS_CACHE_PURGE_OK }));
  });
});
