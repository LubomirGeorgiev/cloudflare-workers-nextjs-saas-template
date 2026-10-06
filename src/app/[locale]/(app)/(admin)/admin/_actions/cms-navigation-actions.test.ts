import { afterEach, describe, expect, test, vi } from "vitest";

import { cmsNavigationKeys } from "@/../cms.config";

const { requireAdminMock, saveCmsNavigationTreeMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  saveCmsNavigationTreeMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

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

vi.mock("@/lib/cms/cms-navigation-repository", () => ({
  saveCmsNavigationTree: saveCmsNavigationTreeMock,
}));

vi.mock("@/lib/cms/cms-icon-rules", () => ({
  buildCustomIconKey: vi.fn(),
  parseUploadedSvgIcon: vi.fn(),
}));

vi.mock("@/lib/cms/cms-icons", () => ({
  searchIcons: vi.fn(),
}));

vi.mock("@/lib/cms/translate-entry", () => ({
  translateText: vi.fn(),
}));

vi.mock("@/utils/with-user-rate-limit", () => ({
  withUserRateLimit: vi.fn((callback: () => unknown) => callback()),
}));

vi.mock("@/utils/with-rate-limit", () => ({
  RATE_LIMITS: { CMS_ICON_PICKER: { limit: 1, window: "1 minute" } },
}));

const { saveCmsNavigationTreeAction } = await import("./cms-navigation-actions");
const { reportCmsCachePurge } = await import("@/lib/cms/cms-cache-purge-report");
const { CMS_CACHE_PURGE_OK, CMS_PURGE_STATUS } = await import("@/constants/cache-purge");

const ZONE_PURGE_FAILED = { ...CMS_CACHE_PURGE_OK, zone: CMS_PURGE_STATUS.FAILED };

const SAVED_TREE = { nodes: [], iconBodyByKey: {} };

describe("CMS navigation actions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // The tree is saved either way; the navigation manager shows a warning toast from this field.
  test("saveCmsNavigationTreeAction reports a failed zone purge from inside the save", async () => {
    requireAdminMock.mockResolvedValue({ userId: "usr_admin" });
    saveCmsNavigationTreeMock.mockImplementation(async () => {
      reportCmsCachePurge(ZONE_PURGE_FAILED);
      return SAVED_TREE;
    });

    const result = await saveCmsNavigationTreeAction({
      navigationKey: cmsNavigationKeys[0],
      items: [],
    });

    expect(result).toEqual({ ...SAVED_TREE, cachePurge: ZONE_PURGE_FAILED });
  });

  test("saveCmsNavigationTreeAction reports no failure when the zone purge went through", async () => {
    requireAdminMock.mockResolvedValue({ userId: "usr_admin" });
    saveCmsNavigationTreeMock.mockImplementation(async () => {
      reportCmsCachePurge(CMS_CACHE_PURGE_OK);
      return SAVED_TREE;
    });

    const result = await saveCmsNavigationTreeAction({
      navigationKey: cmsNavigationKeys[0],
      items: [],
    });

    expect(result).toEqual({ ...SAVED_TREE, cachePurge: CMS_CACHE_PURGE_OK });
  });
});
