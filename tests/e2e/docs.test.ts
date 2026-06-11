import { expect, test } from "vitest";
import {
  expectAppPathname,
  expectAppRole,
  expectAppText,
  fetchAppPath,
  loadAppFrame,
} from "./app-frame";
import { SITE_NAME } from "../../src/constants";

test("renders seeded docs navigation content from fresh D1 state", async () => {
  await loadAppFrame("/docs/getting-started/introduction");

  await expectAppRole("heading", "Introduction", { exact: true });
  await expectAppText(
    "Learn how this template is structured and how to ship your first feature quickly."
  );
});

test("redirects the docs root to the first navigable docs page", async () => {
  await loadAppFrame("/docs");

  await expectAppPathname("/docs/getting-started/introduction");
  await expectAppRole("heading", "Introduction", { exact: true });
});

test("honors seeded docs navigation redirects", async () => {
  await loadAppFrame("/docs/getting-started/setup");

  await expectAppPathname("/docs/getting-started/introduction");
  await expectAppRole("heading", "Introduction", { exact: true });
});

test("serves docs markdown exports for AI and download workflows", async () => {
  const response = await fetchAppPath("/markdown/docs/introduction");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^text\/markdown\b/);

  const body = await response.text();
  expect(body).toMatch(/^# Introduction/m);
  expect(body).toContain("Authentication and team management");
});

test("serves llms.txt from the docs navigation tree", async () => {
  const response = await fetchAppPath("/docs/llms.txt");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^text\/plain\b/);

  const body = await response.text();
  expect(body.split("\n")[0]).toBe(`# ${SITE_NAME}`);
  expect(body).toMatch(/^## Documentation$/m);
  expect(body).toMatch(/^## Search API$/m);
  expect(body).toMatch(/GET https?:\/\/\S+\/api\/docs\/search\?q=authentication&limit=8/);
  expect(body).toMatch(/^- \[Introduction\]\(https?:\/\/[^)]+\/markdown\/docs\/introduction\): /m);
});

test("serves docs search results from the public API endpoint", async () => {
  const response = await fetchAppPath("/api/docs/search?q=authentication&limit=3");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^application\/json\b/);

  const body = await response.json() as {
    results: Array<{
      title: string;
      resolvedPath: string;
      snippet: string;
    }>;
  };

  expect(body.results.length).toBeGreaterThan(0);
  expect(body.results.length).toBeLessThanOrEqual(3);
  expect(body.results[0]).toMatchObject({
    title: "Authentication Setup",
    snippet: expect.stringContaining("Authentication"),
  });
  expect(body.results.every((result) => result.title && result.resolvedPath && result.snippet)).toBe(true);

  const resolvedPath = new URL(body.results[0]?.resolvedPath ?? "");
  expect(resolvedPath.protocol).toMatch(/^https?:$/);
  expect(resolvedPath.pathname).toBe("/docs/getting-started/authentication");
});
