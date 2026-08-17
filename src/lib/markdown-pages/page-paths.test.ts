import { describe, expect, test } from "vitest";

import { SITE_URL } from "@/constants";
import { INDEXED_DOCS_ROUTES } from "@/constants/docs-routes";
import { STATIC_PUBLIC_ROUTES } from "@/constants/public-routes";
import { ENABLED_LOCALES } from "@/i18n/config";

import {
  buildAbsoluteMarkdownPageUrl,
  buildAbsoluteSourcePageUrl,
  buildMarkdownPagePath,
  parseMarkdownPagePath,
} from "./page-paths";

const PAGE_PATHNAMES = new Set<string>([
  "/",
  ...STATIC_PUBLIC_ROUTES.map(({ pathname }) => pathname),
  ...INDEXED_DOCS_ROUTES.map(({ pathname }) => pathname),
]);

const DOCS_PATHNAME = INDEXED_DOCS_ROUTES[0]!.pathname;

describe("markdown page paths", () => {
  test("maps the site root to and from /index.md", () => {
    expect(buildMarkdownPagePath({ pathname: "/" })).toBe("/index.md");
    expect(parseMarkdownPagePath("/index.md")).toBe("/");
  });

  test("round trips a locale root through its index path", () => {
    for (const locale of ENABLED_LOCALES) {
      const localeRoot = `/${locale}`;

      // `/es.md` names no page, so the locale root takes the same `index.md` form as the site root.
      expect(buildMarkdownPagePath({ pathname: localeRoot })).toBe(`${localeRoot}/index.md`);
      expect(parseMarkdownPagePath(`${localeRoot}/index.md`)).toBe(localeRoot);
      expect(buildMarkdownPagePath({ pathname: `${localeRoot}/` })).toBe(`${localeRoot}/index.md`);
    }
  });

  test("keeps an index segment that is not a locale root", () => {
    expect(parseMarkdownPagePath(`${DOCS_PATHNAME}/index.md`)).toBe(`${DOCS_PATHNAME}/index`);
  });

  test("round trips every public page path in both directions", () => {
    for (const pathname of PAGE_PATHNAMES) {
      const markdownPath = buildMarkdownPagePath({ pathname });

      expect(markdownPath.endsWith(".md")).toBe(true);
      expect(parseMarkdownPagePath(markdownPath)).toBe(pathname);
    }
  });

  test("drops a trailing slash and appends the download query", () => {
    expect(buildMarkdownPagePath({ pathname: `${DOCS_PATHNAME}/` })).toBe(`${DOCS_PATHNAME}.md`);
    expect(buildMarkdownPagePath({ pathname: DOCS_PATHNAME, download: true })).toBe(
      `${DOCS_PATHNAME}.md?download`,
    );
  });

  test("returns null for a path that is not Markdown", () => {
    expect(parseMarkdownPagePath(DOCS_PATHNAME)).toBeNull();
    expect(parseMarkdownPagePath("/")).toBeNull();
  });

  test("prefixes the absolute URL with the configured site URL", () => {
    expect(buildAbsoluteMarkdownPageUrl({ pathname: "/" })).toBe(`${SITE_URL}/index.md`);
    expect(buildAbsoluteSourcePageUrl({ pathname: "/" })).toBe(SITE_URL);
    expect(buildAbsoluteSourcePageUrl({ pathname: "/privacy" })).toBe(`${SITE_URL}/privacy`);
  });
});
