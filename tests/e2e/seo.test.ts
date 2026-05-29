import { expect, test } from "vitest";
import { fetchAppPath } from "./app-frame";

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

  const body = await response.text();
  expect(body).toContain("Allow: /");
  expect(body).toContain("Disallow: /dashboard/");
  expect(body).toContain("Disallow: /verify-email");
  expect(body).toMatch(/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m);
});

test("serves a sitemap containing seeded CMS routes and no protected app routes", async () => {
  const response = await fetchAppPath("/sitemap.xml");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/xml");

  const body = await response.text();
  expectAbsoluteLoc(body, "/blog");
  expectAbsoluteLoc(body, "/blog/getting-started-with-nextjs-15");
  expectAbsoluteLoc(body, "/docs/getting-started/introduction");
  expect(body).not.toContain("/dashboard");
  expect(body).not.toContain("/settings");
});
