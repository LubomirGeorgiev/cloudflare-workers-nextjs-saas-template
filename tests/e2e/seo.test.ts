import { expect, test } from "vitest";
import { fetchAppPath } from "./app-frame";

test("serves robots.txt with public crawl rules and protected route exclusions", async () => {
  const response = await fetchAppPath("/robots.txt");

  expect(response.status).toBe(200);

  const body = await response.text();
  expect(body).toContain("Allow: /");
  expect(body).toContain("Disallow: /dashboard/");
  expect(body).toContain("Disallow: /verify-email");
  expect(body).toContain("Sitemap: https://nextjs-saas-template.lubomirgeorgiev.com/sitemap.xml");
});

test("serves a sitemap containing seeded CMS routes and no protected app routes", async () => {
  const response = await fetchAppPath("/sitemap.xml");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/xml");

  const body = await response.text();
  expect(body).toContain("<loc>https://nextjs-saas-template.lubomirgeorgiev.com/blog</loc>");
  expect(body).toContain("<loc>https://nextjs-saas-template.lubomirgeorgiev.com/blog/getting-started-with-nextjs-15</loc>");
  expect(body).toContain("<loc>https://nextjs-saas-template.lubomirgeorgiev.com/docs/getting-started/introduction</loc>");
  expect(body).not.toContain("/dashboard");
  expect(body).not.toContain("/settings");
});
