import { test } from "vitest";
import { expectAppRole, loadAppFrame } from "./app-frame";

test("renders the landing page from the preview worker", async () => {
  await loadAppFrame("/");

  await expectAppRole("heading", "Production-Ready SaaS Template");
  await expectAppRole("link", "Try Demo");
});
