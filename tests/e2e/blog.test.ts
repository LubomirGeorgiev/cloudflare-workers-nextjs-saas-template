import { test } from "vitest";
import {
  expectAppPathname,
  expectAppRole,
  expectAppText,
  expectNoAppText,
  loadAppFrame,
} from "./app-frame";

test("renders seeded blog content from fresh D1 state", async () => {
  await loadAppFrame("/blog");

  await expectAppRole("heading", "Blog", { exact: true });
  await expectAppText("Getting Started with Next.js 15", { exact: true });
});

test("renders a full seeded blog article with author, tags, and rich content", async () => {
  await loadAppFrame("/blog/getting-started-with-nextjs-15");

  await expectAppRole("heading", "Getting Started with Next.js 15", { exact: true });
  await expectAppText("Test Testov", { exact: true });
  await expectAppText("Next.js", { exact: true });
  await expectAppText("React", { exact: true });
  await expectAppText("TypeScript", { exact: true });
  await expectAppText("Build Your First Next.js 15 Page", { exact: true });
  await expectAppText("Starter Project Checklist", { exact: true });
});

test("routes numbered blog pages to the correct paginated result set", async () => {
  await loadAppFrame("/blog/2");

  await expectAppPathname("/blog/2");
  await expectAppRole("heading", "Blog", { exact: true });
  await expectAppText("Advanced Git Workflows for Teams", { exact: true });
  await expectNoAppText("Getting Started with Next.js 15", { exact: true });
});

test("filters blog posts by seeded tag", async () => {
  await loadAppFrame("/blog/tags/cloudflare");

  await expectAppRole("heading", "Cloudflare", { exact: true });
  await expectAppText("3 posts", { exact: true });
  await expectAppText("Building Scalable APIs with Cloudflare Workers", { exact: true });
  await expectAppText("Optimizing Web Performance with Edge Computing", { exact: true });
});

test("filters blog posts by seeded author", async () => {
  await loadAppFrame("/blog/authors/test-testov--usr_lyo1up6a9q75dmpv3o5x9irj");

  await expectAppRole("heading", "Test Testov", { exact: true });
  await expectAppText("7 posts", { exact: true });
  await expectAppText("Getting Started with Next.js 15", { exact: true });
  await expectAppText("Serverless Architecture Patterns", { exact: true });
});
