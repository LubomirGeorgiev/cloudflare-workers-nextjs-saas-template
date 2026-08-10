import { expect, test } from "vitest";
import { fetchAppPath } from "./app-frame";
import { API_AUTH_DOCS_PATH, API_DOCS_PATH, MCP_DOCS_PATH } from "../../src/constants";
import { DEFAULT_LOCALE, ENABLED_LOCALES } from "../../src/i18n/config";
import { SEEDED_BLOG_ENTRY_PATH, SEEDED_DOCS_ENTRY_PATH } from "./seed-fixtures";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expectAbsoluteLoc(body: string, pathname: string): void {
  expect(body).toMatch(
    new RegExp(`<loc>https?://[^<]+${escapeRegExp(pathname)}</loc>`)
  );
}

test("serves robots.txt with public crawl rules and protected route exclusions", async () => {
  const response = await fetchAppPath("/robots.txt");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^text\/plain\b/);

  const body = await response.text();
  expect(body).toMatch(/^Allow: \/$/m);
  expect(body).toMatch(/^Disallow: \/dashboard\/$/m);
  expect(body).toMatch(/^Disallow: \/verify-email$/m);
  expect(body).toMatch(/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m);
});

// Protected routes live under `app/[locale]`, so each is reachable at `/<locale>/...` too. The
// bare-path rules above only cover the default locale, which the `as-needed` prefix leaves unprefixed.
test("excludes protected routes under every served locale prefix", async () => {
  const response = await fetchAppPath("/robots.txt");
  const body = await response.text();
  const prefixedLocales = ENABLED_LOCALES.filter((locale) => locale !== DEFAULT_LOCALE);

  for (const locale of prefixedLocales) {
    for (const pathname of ["/dashboard/", "/verify-email", "/oauth/"]) {
      expect(body).toMatch(
        new RegExp(`^Disallow: ${escapeRegExp(`/${locale}${pathname}`)}$`, "m")
      );
    }
  }

  // With I18N_ENABLED false the loop above is empty, which would pass while asserting nothing.
  // Assert the disabled mode's real contract instead: no prefixed rule may exist at all.
  if (prefixedLocales.length === 0) {
    expect(body).not.toMatch(/^Disallow: \/[a-z]{2}(?:-[A-Z]{2})?\/dashboard\/$/m);
  }
});

test("serves a sitemap containing seeded CMS routes and no protected app routes", async () => {
  const response = await fetchAppPath("/sitemap.xml");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^application\/xml\b/);

  const body = await response.text();
  expectAbsoluteLoc(body, "/blog");
  expectAbsoluteLoc(body, SEEDED_BLOG_ENTRY_PATH);
  expectAbsoluteLoc(body, SEEDED_DOCS_ENTRY_PATH);
  expectAbsoluteLoc(body, API_DOCS_PATH);
  expectAbsoluteLoc(body, API_AUTH_DOCS_PATH);
  expectAbsoluteLoc(body, MCP_DOCS_PATH);
  expect(body).not.toMatch(/<loc>[^<]*(?:\/dashboard|\/settings)[^<]*<\/loc>/);
});
