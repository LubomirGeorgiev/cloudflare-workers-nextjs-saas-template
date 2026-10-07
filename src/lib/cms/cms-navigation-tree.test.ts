import { describe, expect, test } from "vitest";

import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation";

import { selectNavigationRootPath } from "./cms-navigation-tree";

interface TestNode {
  nodeType: string;
  resolvedPath: string | null;
  live: boolean;
  children: TestNode[];
}

function page(resolvedPath: string, live = true): TestNode {
  return { nodeType: CMS_NAVIGATION_NODE_TYPES.PAGE, resolvedPath, live, children: [] };
}

function group(resolvedPath: string | null, children: TestNode[]): TestNode {
  return { nodeType: CMS_NAVIGATION_NODE_TYPES.GROUP, resolvedPath, live: false, children };
}

function rootPath(nodes: TestNode[]): string | null {
  return selectNavigationRootPath({ nodes, isLivePage: (node) => node.live });
}

describe("selectNavigationRootPath", () => {
  test("takes the first live page, depth first", () => {
    expect(rootPath([
      group("/docs/start", [page("/docs/start/intro"), page("/docs/start/next")]),
      page("/docs/cli"),
    ])).toBe("/docs/start/intro");
  });

  // An unpublished first page hands the link to the next live page.
  test("skips a page that is not live, and keeps its live children in place", () => {
    expect(rootPath([
      { ...page("/docs/draft", false), children: [page("/docs/draft/child")] },
      page("/docs/cli"),
    ])).toBe("/docs/draft/child");
    expect(rootPath([group(null, [page("/docs/a", false)]), page("/docs/cli")])).toBe("/docs/cli");
  });

  test("never takes a group, even one with a path", () => {
    expect(rootPath([group("/docs/start", [])])).toBeNull();
  });

  test("a tree with no live page has no root path", () => {
    expect(rootPath([])).toBeNull();
    expect(rootPath([page("/docs/a", false)])).toBeNull();
  });
});
