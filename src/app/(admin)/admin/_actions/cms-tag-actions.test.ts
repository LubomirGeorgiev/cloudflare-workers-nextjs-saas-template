import { afterEach, describe, expect, test, vi } from "vitest";

import { DEFAULT_LOCALE, ENABLED_LOCALES } from "@/i18n/config";

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

const { deleteCmsTagAction } = await import("./cms-tag-actions");

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
      expect(revalidatePathMock).toHaveBeenCalledWith(`${prefix}/blog/tags`);
      expect(revalidatePathMock).toHaveBeenCalledWith(`${prefix}/blog/tags/release-notes`);
    }
  });
});
