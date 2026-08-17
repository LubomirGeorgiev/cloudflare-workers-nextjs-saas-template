import { describe, expect, test } from "vitest";

import { INDEXED_DOCS_ROUTES } from "@/constants/docs-routes";
import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALES } from "@/i18n/config";

import { buildMarkdownPagePath } from "./page-paths";
import { rewritePageLinkUrl } from "./rewrite-links";

const SOURCE_ORIGIN = "https://example.com";
const SOURCE_URL = `${SOURCE_ORIGIN}/index.md`;
const DOCS_PAGE_PATHNAME = INDEXED_DOCS_ROUTES[0]!.pathname;

// A locale the router serves, and one the catalog holds but `I18N_ENABLED` de-served.
const SERVED_LOCALE = ENABLED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE);
const DE_SERVED_LOCALE = LOCALES.find((locale) => !ENABLED_LOCALES.includes(locale));

function rewrite(href: string): string | undefined {
  return rewritePageLinkUrl({ href, sourceUrl: SOURCE_URL });
}

describe("rewritePageLinkUrl", () => {
  test("points an allowlisted page link at its .md path", () => {
    expect(rewrite(DOCS_PAGE_PATHNAME)).toBe(
      `${SOURCE_ORIGIN}${buildMarkdownPagePath({ pathname: DOCS_PAGE_PATHNAME })}`,
    );
  });

  test("leaves a link the Markdown surface does not serve alone", () => {
    expect(rewrite("/dashboard")).toBe(`${SOURCE_ORIGIN}/dashboard`);
    expect(rewrite("#section")).toBe("#section");
    expect(rewrite("https://other.example/docs")).toBe("https://other.example/docs");
  });

  // The path rule itself now sends a locale root to `/<locale>/index.md`, so the rewriter needs no
  // special case of its own.
  test.skipIf(!SERVED_LOCALE)("points a served locale root at its index .md path", () => {
    const locale = SERVED_LOCALE!;

    expect(rewrite(`/${locale}`)).toBe(
      `${SOURCE_ORIGIN}${buildMarkdownPagePath({ pathname: `/${locale}` })}`,
    );
    expect(rewrite(`/${locale}`)).toBe(`${SOURCE_ORIGIN}/${locale}/index.md`);
  });

  test.skipIf(!DE_SERVED_LOCALE)("leaves a de-served locale root alone", () => {
    const locale = DE_SERVED_LOCALE!;

    expect(rewrite(`/${locale}`)).toBe(`${SOURCE_ORIGIN}/${locale}`);
    expect(rewrite(`/${locale}${DOCS_PAGE_PATHNAME}`)).toBe(
      `${SOURCE_ORIGIN}/${locale}${DOCS_PAGE_PATHNAME}`,
    );
  });
});
