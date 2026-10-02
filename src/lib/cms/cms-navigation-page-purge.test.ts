import { describe, expect, test, vi } from "vitest";

const { purgeEdgeHtmlPagesMock, purgeMarkdownPageCacheMock } = vi.hoisted(() => ({
  purgeEdgeHtmlPagesMock: vi.fn(async (__input: unknown): Promise<number> => 0),
  purgeMarkdownPageCacheMock: vi.fn(async (__input: unknown) => undefined),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/edge/edge-html-cache", () => ({
  purgeEdgeHtmlPages: purgeEdgeHtmlPagesMock,
}));

vi.mock("@/lib/markdown-pages/purge-page-cache", () => ({
  purgeMarkdownPageCache: purgeMarkdownPageCacheMock,
}));

const { DOCS_EDGE_HTML_PATHNAMES, purgeDocsNavigationMarkdownPages } = await import(
  "./cms-navigation-page-purge"
);

describe("purgeDocsNavigationMarkdownPages", () => {
  // A `.md` miss converts the stored page, so a twin deleted first would refill from the old page.
  test("waits for the stored HTML purge before it deletes the `.md` twins", async () => {
    let release = () => {};
    purgeEdgeHtmlPagesMock.mockImplementationOnce(
      () => new Promise<number>((resolve) => {
        release = () => resolve(0);
      }),
    );

    const pending = purgeDocsNavigationMarkdownPages();

    await vi.waitFor(() => expect(purgeEdgeHtmlPagesMock).toHaveBeenCalledWith({
      pathnames: DOCS_EDGE_HTML_PATHNAMES,
    }));
    expect(purgeMarkdownPageCacheMock).not.toHaveBeenCalled();

    release();
    await pending;

    expect(purgeMarkdownPageCacheMock).toHaveBeenCalledTimes(1);
  });
});
