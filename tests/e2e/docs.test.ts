import { expect, test } from "vitest";
import {
  expectAppPathname,
  expectAppRole,
  expectAppText,
  fetchAppPath,
  loadAppFrame,
} from "./app-frame";

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
  expect(response.headers.get("content-type")).toContain("text/markdown");

  const body = await response.text();
  expect(body).toContain("# Introduction");
  expect(body).toContain("Authentication and team management");
});

test("serves llms.txt from the docs navigation tree", async () => {
  const response = await fetchAppPath("/docs/llms.txt");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/plain");

  const body = await response.text();
  expect(body).toContain("Introduction");
  expect(body).toContain("/markdown/docs/introduction");
  expect(body).toContain("/api/docs/search?q=authentication&limit=8");
});

test("serves docs search results from the public API endpoint", async () => {
  const response = await fetchAppPath("/api/docs/search?q=authentication&limit=3");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");

  const body = await response.json() as {
    results: Array<{
      title: string;
      resolvedPath: string;
      snippet: string;
    }>;
  };

  expect(body.results.length).toBeGreaterThan(0);
  expect(body.results[0]?.title).toContain("Authentication");
  expect(body.results[0]?.resolvedPath).toBe(
    "https://nextjs-saas-template.lubomirgeorgiev.com/docs/getting-started/authentication"
  );
});
