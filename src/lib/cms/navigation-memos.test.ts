import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { clearNavigationMemos, createNavigationMemo } = await import("./navigation-memos");

describe("navigation memos", () => {
  test("holds a build result and drops it on the group clear", async () => {
    const build = vi.fn(async (key: string) => `value-${key}`);
    const memo = createNavigationMemo({ build, maxEntries: 4 });

    await expect(memo.read("docs")).resolves.toBe("value-docs");
    await memo.read("docs");
    expect(build).toHaveBeenCalledTimes(1);

    clearNavigationMemos();
    await memo.read("docs");

    expect(build).toHaveBeenCalledTimes(2);
  });

  // Finding 1: a navigation save clears the tree, but the header and the docs page memoize results
  // derived from it, so every memo has to go together.
  test("the group clear reaches every memo, not just the one that was read", async () => {
    const buildTree = vi.fn(async () => "tree");
    const buildLinks = vi.fn(async () => "links");
    const tree = createNavigationMemo({ build: buildTree, maxEntries: 1 });
    const links = createNavigationMemo({ build: buildLinks, maxEntries: 1 });

    await Promise.all([tree.read(), links.read()]);
    clearNavigationMemos();
    await Promise.all([tree.read(), links.read()]);

    expect(buildTree).toHaveBeenCalledTimes(2);
    expect(buildLinks).toHaveBeenCalledTimes(2);
  });

  // The group clear is the only clear: a per-memo one let a caller drop one reader's copy and leave
  // the others serving the pre-invalidation tree.
  test("a memo exposes its read and nothing else", () => {
    const memo = createNavigationMemo({ build: async () => "value", maxEntries: 1 });

    expect(Object.keys(memo)).toEqual(["read"]);
  });

  test("`keyOf` names the values the read keys on", async () => {
    const build = vi.fn(async ({ locale }: { locale: string }) => `page-${locale}`);
    const memo = createNavigationMemo({
      build,
      keyOf: ({ locale }: { locale: string }) => locale,
      maxEntries: 4,
    });

    // Two different objects, one key: without `keyOf` the default would join them as "[object Object]".
    await memo.read({ locale: "en" });
    await memo.read({ locale: "en" });
    await memo.read({ locale: "de" });

    expect(build).toHaveBeenCalledTimes(2);
    clearNavigationMemos();
  });
});
