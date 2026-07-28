import { expect, test } from "vitest";
import { fetchAppPath } from "./app-frame";
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

test("serves a sitemap containing seeded CMS routes and no protected app routes", async () => {
  const response = await fetchAppPath("/sitemap.xml");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^application\/xml\b/);

  const body = await response.text();
  expectAbsoluteLoc(body, "/blog");
  expectAbsoluteLoc(body, SEEDED_BLOG_ENTRY_PATH);
  expectAbsoluteLoc(body, SEEDED_DOCS_ENTRY_PATH);
  expect(body).not.toMatch(/<loc>[^<]*(?:\/dashboard|\/settings)[^<]*<\/loc>/);
});
