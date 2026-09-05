import { beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import { getCmsNavigationConfig } from "@/lib/cms/cms-navigation-config";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { CACHE_TAGS } from "@/constants/cache-tags";

const { tree, ancestors, adjacent, setCacheScope, redirect } = vi.hoisted(() => ({
  tree: vi.fn(), ancestors: vi.fn(), adjacent: vi.fn(), setCacheScope: vi.fn(), redirect: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/utils/cache", async () => ({ ...await import("@/constants/cache-tags"), setCacheScope }));
vi.mock("@/lib/cms/cms-navigation-repository", () => ({
  getCmsNavigationTree: tree,
  getCmsNavigationAncestors: ancestors,
  getCmsNavigationPrevNext: adjacent,
  getCmsNavigationRedirectByPath: redirect,
  getCmsNavigationRootPath: vi.fn(),
  getCmsNavigationNodeByResolvedPath: ({ path, nodes }: { path: string; nodes: { resolvedPath: string }[] }) =>
    nodes.find((node) => node.resolvedPath === path) ?? null,
}));

const { resolveCurrentDocsPage } = await import("./resolve-current-docs-page");
const BASE_PATH = getCmsNavigationConfig(DOCS_SLUG).basePath;
const LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE);
const NODE = {
  id: "guide", title: "Stored title", resolvedPath: `${BASE_PATH}/guide`, nodeType: "page",
  entry: { title: "Entry title", seoDescription: "Entry description" }, children: [],
};
const GROUP = { id: "group", title: "Group", resolvedPath: BASE_PATH, entry: null, children: [NODE] };

beforeEach(() => {
  vi.clearAllMocks();
  tree.mockResolvedValue([NODE]);
  ancestors.mockReturnValue([GROUP]);
  adjacent.mockReturnValue({ previous: NODE, next: null });
  redirect.mockResolvedValue(null);
});

describe("cached docs page data", () => {
  test("stores compact links and includes both navigation and redirect invalidation tags", async () => {
    const result = await resolveCurrentDocsPage({ slugParts: ["guide"], locale: DEFAULT_LOCALE });
    expect(result).toMatchObject({
      type: "page",
      breadcrumbs: [{ id: "group", title: "Group", resolvedPath: BASE_PATH, description: null }],
      previous: { id: "guide", title: "Entry title", description: "Entry description" }, next: null,
    });
    expect(result).not.toHaveProperty("navigationTree");
    if (result.type === "page") {
      expect(result.breadcrumbs[0]).not.toHaveProperty("children");
      expect(result.previous).not.toHaveProperty("entry");
    }
    expect(setCacheScope).toHaveBeenCalledWith({
      tags: [CACHE_TAGS.cmsNavigation(DOCS_SLUG), CACHE_TAGS.cmsRedirect(DOCS_SLUG)], ttl: "8 hours",
    });
  });

  test.skipIf(!LOCALE)("derives fallback links from the default locale tree", async () => {
    tree.mockImplementation(({ locale }) => locale === DEFAULT_LOCALE ? [NODE] : [GROUP]);
    const result = await resolveCurrentDocsPage({ slugParts: ["guide"], locale: LOCALE! });
    expect(result).toMatchObject({ type: "page", isFallback: true });
    expect(ancestors).toHaveBeenCalledWith({ nodeId: NODE.id, nodes: [NODE] });
  });

  test("preserves renamed paths without trying to derive links", async () => {
    redirect.mockResolvedValue({ toPath: NODE.resolvedPath, statusCode: 301 });
    expect(await resolveCurrentDocsPage({ slugParts: ["old"], locale: DEFAULT_LOCALE })).toEqual({
      type: "redirect", path: NODE.resolvedPath, permanent: true,
    });
    expect(ancestors).not.toHaveBeenCalled();
  });
});
