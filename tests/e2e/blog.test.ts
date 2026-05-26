import { test } from "vitest";
import { expectAppRole, expectAppText, loadAppFrame } from "./app-frame";

test("renders seeded blog content from fresh D1 state", async () => {
  await loadAppFrame("/blog");

  await expectAppRole("heading", "Blog", { exact: true });
  await expectAppText("Getting Started with Next.js 15", { exact: true });
});
